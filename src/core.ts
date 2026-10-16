// Thin wrapper around coopiano.wasm. Runs anywhere WebAssembly runs,
// including AudioWorkletGlobalScope (no fetch, no DOM, no Emscripten glue).

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  coopiano_create(sampleRate: number): number;
  coopiano_destroy(p: number): void;
  coopiano_left(p: number): number;
  coopiano_right(p: number): number;
  coopiano_latency(p: number): number;
  coopiano_note_on(p: number, key: number, velocity: number, channel: number): number;
  coopiano_note_off(p: number, key: number, channel: number): number;
  coopiano_pedal(p: number, channel: number, position: number): number;
  coopiano_reset(p: number): void;
  coopiano_process(p: number, frames: number): number;
}

export const MAX_FRAMES = 128;

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

  /** Synchronous, so that it works inside an AudioWorkletProcessor constructor. */
  static create(module: WebAssembly.Module, sampleRate: number): CoopianoCore {
    let core: CoopianoCore | undefined;
    const instance = new WebAssembly.Instance(module, {
      env: { emscripten_notify_memory_growth: () => core?.refreshViews() },
      wasi_snapshot_preview1: { fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0 },
    });
    const x = instance.exports as unknown as Exports;
    x._initialize();
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

  /** Handles note on/off, CC64 (sustain), CC120/123 (all sound/notes off). */
  midi(bytes: ArrayLike<number>) {
    const status = bytes[0] & 0xf0;
    const channel = bytes[0] & 0x0f;
    if (status === 0x90) this.x.coopiano_note_on(this.p, bytes[1], bytes[2], channel);
    else if (status === 0x80) this.x.coopiano_note_off(this.p, bytes[1], channel);
    else if (status === 0xb0) {
      if (bytes[1] === 64) this.x.coopiano_pedal(this.p, channel, bytes[2] / 127);
      else if (bytes[1] === 120 || bytes[1] === 123) this.x.coopiano_reset(this.p);
    }
  }

  reset() {
    this.x.coopiano_reset(this.p);
  }

  /** Renders `frames` (at most 128) into out[0] and out[1], starting at `offset`. */
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
