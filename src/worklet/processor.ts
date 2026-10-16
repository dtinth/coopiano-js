// AudioWorklet processor for the standalone app and the WebMidiLink page.
// The main thread posts raw MIDI messages; they apply at the next render quantum.
import { CoopianoCore } from "../core.ts";

export type CoopianoProcessorMessage = { type: "midi"; data: number[] };

class CoopianoProcessor extends AudioWorkletProcessor {
  private readonly core: CoopianoCore;
  private readonly queue: number[][] = [];

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { wasm } = options.processorOptions as { wasm: ArrayBuffer };
    this.core = CoopianoCore.create(new WebAssembly.Module(wasm), sampleRate);
    this.port.onmessage = (e: MessageEvent<CoopianoProcessorMessage>) => {
      if (e.data.type === "midi") this.queue.push(e.data.data);
    };
    this.port.postMessage({ type: "ready", latencySamples: this.core.latencySamples });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    for (const bytes of this.queue.splice(0)) this.core.midi(bytes);
    const [left, right] = outputs[0];
    this.core.process(left, right, 0, left.length);
    return true;
  }
}

registerProcessor("coopiano", CoopianoProcessor);
