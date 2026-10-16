// Thin wrappers around coopiano.wasm. They run anywhere WebAssembly runs,
// including AudioWorkletGlobalScope and Workers (no fetch, no DOM, no Emscripten glue).

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  coopiano_create(sampleRate: number): number;
  coopiano_destroy(p: number): void;
  coopiano_left(p: number): number;
  coopiano_right(p: number): number;
  coopiano_latency(p: number): number;
  coopiano_note_on(p: number, key: number, velocity: number, channel: number): number;
  coopiano_note_on_cached(p: number, key: number, velocity: number, channel: number): number;
  coopiano_note_off(p: number, key: number, channel: number): number;
  coopiano_pedal(p: number, channel: number, position: number): number;
  coopiano_reset(p: number): void;
  coopiano_process(p: number, frames: number): number;
  coopiano_contact_key(key: number): number;
  coopiano_has_contact(p: number, key: number, velocity: number): number;
  coopiano_contact_count(p: number): number;
  coopiano_install_buffer(p: number, count: number): number;
  coopiano_install_contact(p: number): number;
  coopiano_producer_create(): number;
  coopiano_produce(q: number, key: number, velocity: number): number;
  coopiano_produce_size(q: number): number;
}

export const MAX_FRAMES = 128;

/** Synchronous, so that it works inside an AudioWorkletProcessor constructor. */
function instantiate(module: WebAssembly.Module, onMemoryGrowth?: () => void): Exports {
  const instance = new WebAssembly.Instance(module, {
    env: { emscripten_notify_memory_growth: () => onMemoryGrowth?.() },
    wasi_snapshot_preview1: { fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0 },
  });
  const x = instance.exports as unknown as Exports;
  x._initialize();
  return x;
}

/** The instrument: engine, resampler and contact-response cache. Audio thread. */
export class CoopianoCore {
  private readonly x: Exports;
  private readonly p: number;
  private left!: Float32Array;
  private right!: Float32Array;

  private constructor(x: Exports, p: number) {
    this.x = x;
    this.p = p;
    this.refreshViews();
  }

  static create(module: WebAssembly.Module, sampleRate: number): CoopianoCore {
    let core: CoopianoCore | undefined;
    const x = instantiate(module, () => core?.refreshViews());
    const p = x.coopiano_create(sampleRate);
    if (!p) throw new Error(`coopiano: unsupported sample rate ${sampleRate}`);
    core = new CoopianoCore(x, p);
    return core;
  }

  private refreshViews() {
    const buffer = this.x.memory.buffer;
    this.left = new Float32Array(buffer, this.x.coopiano_left(this.p), MAX_FRAMES);
    this.right = new Float32Array(buffer, this.x.coopiano_right(this.p), MAX_FRAMES);
  }

  get latencySamples() {
    return this.x.coopiano_latency(this.p);
  }

  /** Prepares the whole strike on this thread, including contact simulation (0.05–5 ms). */
  noteOn(key: number, velocity: number, channel: number) {
    this.x.coopiano_note_on(this.p, key, velocity, channel);
  }

  /** 1 = started, 0 = contact response not installed yet, -1 = invalid. About 0.1 ms. */
  noteOnCached(key: number, velocity: number, channel: number): number {
    return this.x.coopiano_note_on_cached(this.p, key, velocity, channel);
  }

  noteOff(key: number, channel: number) {
    this.x.coopiano_note_off(this.p, key, channel);
  }

  /** position: 0 (up) to 1 (down). */
  pedal(channel: number, position: number) {
    this.x.coopiano_pedal(this.p, channel, position);
  }

  /** The physical key (21–108) whose contact response a MIDI key uses. */
  contactKey(key: number) {
    return this.x.coopiano_contact_key(key);
  }

  hasContact(contactKey: number, velocity: number) {
    return this.x.coopiano_has_contact(this.p, contactKey, velocity) !== 0;
  }

  get contactCount() {
    return this.x.coopiano_contact_count(this.p);
  }

  /** Installs a contact response from ContactProducer. Allocates inside wasm. */
  installContact(data: Float64Array): boolean {
    const pointer = this.x.coopiano_install_buffer(this.p, data.length);
    new Float64Array(this.x.memory.buffer, pointer, data.length).set(data);
    return this.x.coopiano_install_contact(this.p) !== 0;
  }

  /** Silences all voices and effect tails at once. */
  reset() {
    this.x.coopiano_reset(this.p);
  }

  /** Renders `frames` (at most 128) into outL and outR, starting at `offset`. */
  process(outL: Float32Array, outR: Float32Array | undefined, offset: number, frames: number) {
    if (frames <= 0) return;
    if (!this.x.coopiano_process(this.p, frames)) {
      outL.fill(0, offset, offset + frames);
      outR?.fill(0, offset, offset + frames);
      return;
    }
    outL.set(this.left.subarray(0, frames), offset);
    outR?.set(this.right.subarray(0, frames), offset);
  }

  destroy() {
    this.x.coopiano_destroy(this.p);
  }
}

/** Computes serialized contact responses (the expensive part of a strike). Worker thread. */
export class ContactProducer {
  private readonly x: Exports;
  private readonly q: number;

  constructor(module: WebAssembly.Module) {
    this.x = instantiate(module);
    this.q = this.x.coopiano_producer_create();
  }

  /** Returns a copy, ready to transfer. Empty for keys outside 21–108 or velocity outside 1–127. */
  compute(contactKey: number, velocity: number): Float64Array {
    const pointer = this.x.coopiano_produce(this.q, contactKey, velocity);
    const size = this.x.coopiano_produce_size(this.q);
    return new Float64Array(this.x.memory.buffer, pointer, size).slice();
  }
}
