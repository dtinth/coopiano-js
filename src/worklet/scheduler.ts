// MIDI handling shared by both AudioWorklet processors.
//
// A note-on whose contact response is cached starts at once (about 0.1 ms of work).
// Otherwise the note waits: a contact worker computes the response, posts it back, and
// the note starts in the first render quantum after it arrives. Expensive contact
// simulation never runs on the audio thread, unless no worker is connected.
import type { CoopianoCore } from "../core.ts";

/** Main thread → processor, through the AudioWorkletNode's port. */
export type ContactPortMessage = { type: "coopiano-contact-port"; port: MessagePort };

/** Processor → worker. */
export type ContactRequest = { key: number; velocity: number; background: boolean };

/** Keyboard velocity in WebMIDICon. Responses for it are computed in the background at startup. */
const PREWARM_VELOCITY = 0x60;

interface PendingNote {
  key: number;
  velocity: number;
  channel: number;
  released: boolean;
  /** currentTime when the note-on arrived. */
  time: number;
}

export interface SchedulerStats {
  /** Notes that had to wait for a worker. */
  misses: number;
  /** Notes that started at once. */
  hits: number;
  /** Longest wait for a worker, in seconds. */
  maxWait: number;
  /** Contact responses installed in the cache. */
  cached: number;
}

export class NoteScheduler {
  private readonly core: CoopianoCore;
  private readonly ports: MessagePort[] = [];
  private readonly pending: PendingNote[] = [];
  private readonly requested = new Set<number>();
  private nextPort = 0;
  readonly stats: SchedulerStats = { misses: 0, hits: 0, maxWait: 0, cached: 0 };

  constructor(core: CoopianoCore) {
    this.core = core;
  }

  /** Handles a message from the node's port. Returns false if it is not for the scheduler. */
  handleNodeMessage(data: unknown): boolean {
    const message = data as ContactPortMessage | undefined;
    if (message?.type !== "coopiano-contact-port") return false;
    const port = message.port;
    port.onmessage = (e: MessageEvent<Float64Array>) => this.install(e.data);
    this.ports.push(port);
    // Spread the prewarm requests over the workers as they connect.
    for (let key = 21 + this.ports.length - 1; key <= 108; key += 4) {
      this.request(key, PREWARM_VELOCITY, true, port);
    }
    return true;
  }

  midi(bytes: ArrayLike<number>) {
    const status = bytes[0] & 0xf0;
    const channel = bytes[0] & 0x0f;
    if (status === 0x90 && bytes[2] > 0) this.noteOn(bytes[1], bytes[2], channel);
    else if (status === 0x80 || status === 0x90) this.noteOff(bytes[1], channel);
    else if (status === 0xb0) {
      if (bytes[1] === 64) this.core.pedal(channel, bytes[2] / 127);
      else if (bytes[1] === 120 || bytes[1] === 123) {
        this.pending.length = 0;
        this.core.reset();
      }
    }
  }

  private noteOn(key: number, velocity: number, channel: number) {
    if (!this.ports.length) {
      this.core.noteOn(key, velocity, channel);
      return;
    }
    // A note behind a pending note on the same key must not overtake it.
    const queued = this.pending.some((n) => n.key === key && n.channel === channel);
    if (!queued && this.core.noteOnCached(key, velocity, channel) !== 0) {
      this.stats.hits++;
      return;
    }
    this.stats.misses++;
    this.pending.push({ key, velocity, channel, released: false, time: currentTime });
    this.request(this.core.contactKey(key), velocity, false);
  }

  private noteOff(key: number, channel: number) {
    // Release the newest pending note on this key; it will sound briefly once ready,
    // like a very short key press.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const note = this.pending[i];
      if (note.key === key && note.channel === channel && !note.released) {
        note.released = true;
        return;
      }
    }
    this.core.noteOff(key, channel);
  }

  private request(contactKey: number, velocity: number, background: boolean, port?: MessagePort) {
    const id = contactKey * 128 + velocity;
    if (this.requested.has(id) || this.core.hasContact(contactKey, velocity)) return;
    this.requested.add(id);
    port ??= this.ports[this.nextPort++ % this.ports.length];
    port.postMessage({ key: contactKey, velocity, background } satisfies ContactRequest);
  }

  private install(data: Float64Array) {
    if (!this.core.installContact(data)) return;
    this.stats.cached = this.core.contactCount;
    // Start the waiting notes that can start now, in arrival order.
    let i = 0;
    while (i < this.pending.length) {
      const note = this.pending[i];
      const earlier = this.pending
        .slice(0, i)
        .some((n) => n.key === note.key && n.channel === note.channel);
      if (earlier || this.core.noteOnCached(note.key, note.velocity, note.channel) === 0) {
        i++;
        continue;
      }
      this.stats.maxWait = Math.max(this.stats.maxWait, currentTime - note.time);
      if (note.released) this.core.noteOff(note.key, note.channel);
      this.pending.splice(i, 1);
    }
  }
}
