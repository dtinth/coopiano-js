// AudioWorklet processor for the standalone app and the WebMidiLink page.
// The main thread posts raw MIDI messages; they apply at the next render quantum.
import { CoopianoCore } from "../core.ts";
import { NoteScheduler } from "./scheduler.ts";

export type CoopianoProcessorMessage = { type: "midi"; data: number[] } | { type: "stats" };

class CoopianoProcessor extends AudioWorkletProcessor {
  private readonly core: CoopianoCore;
  private readonly scheduler: NoteScheduler;
  private readonly queue: number[][] = [];

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { wasm } = options.processorOptions as { wasm: ArrayBuffer };
    this.core = CoopianoCore.create(new WebAssembly.Module(wasm), sampleRate);
    this.scheduler = new NoteScheduler(this.core);
    this.port.onmessage = (e: MessageEvent<CoopianoProcessorMessage>) => {
      if (this.scheduler.handleNodeMessage(e.data)) return;
      if (e.data.type === "midi") this.queue.push(e.data.data);
      else if (e.data.type === "stats")
        this.port.postMessage({ type: "stats", stats: this.scheduler.stats });
    };
    this.port.postMessage({ type: "ready", latencySamples: this.core.latencySamples });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    for (const bytes of this.queue.splice(0)) this.scheduler.midi(bytes);
    const [left, right] = outputs[0];
    this.core.process(left, right, 0, left.length);
    return true;
  }
}

registerProcessor("coopiano", CoopianoProcessor);
