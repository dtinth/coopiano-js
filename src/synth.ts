// Main-thread handle for the plain coopiano AudioWorkletNode.
import processorUrl from "./worklet/processor.ts?worker&url";
import wasmUrl from "./generated/coopiano.wasm?url";

export class Synth {
  readonly node: AudioWorkletNode;
  readonly ready: Promise<void>;

  private constructor(node: AudioWorkletNode) {
    this.node = node;
    this.ready = new Promise((resolve) => {
      node.port.onmessage = (e) => {
        if (e.data.type === "ready") resolve();
      };
    });
  }

  static async create(context: AudioContext): Promise<Synth> {
    const [wasm] = await Promise.all([
      fetch(wasmUrl).then((r) => r.arrayBuffer()),
      context.audioWorklet.addModule(processorUrl),
    ]);
    const node = new AudioWorkletNode(context, "coopiano", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm },
    });
    const synth = new Synth(node);
    await synth.ready;
    return synth;
  }

  send(data: ArrayLike<number>) {
    this.node.port.postMessage({ type: "midi", data: Array.from(data) });
  }
}
