// Main-thread handle for the plain coopiano AudioWorkletNode.
import processorUrl from "./worklet/processor.ts?worker&url";
import wasmUrl from "./generated/coopiano.wasm?url";
import { connectContactWorkers } from "./contact-workers.ts";
import type { ParameterValues } from "./params.ts";
import type { SchedulerStats } from "./worklet/scheduler.ts";

export class Synth {
  readonly node: AudioWorkletNode;
  readonly ready: Promise<void>;

  private constructor(node: AudioWorkletNode) {
    this.node = node;
    this.ready = new Promise((resolve) => {
      node.port.onmessage = (e) => {
        if (e.data.type === "ready") resolve();
        if (e.data.type === "stats") this.onStats?.(e.data.stats as SchedulerStats);
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
    connectContactWorkers(node, wasm);
    return synth;
  }

  onStats?: (stats: SchedulerStats) => void;

  requestStats() {
    this.node.port.postMessage({ type: "stats" });
  }

  setParameters(values: Partial<ParameterValues>) {
    this.node.port.postMessage({ type: "parameters", values });
  }

  send(data: ArrayLike<number>) {
    this.node.port.postMessage({ type: "midi", data: Array.from(data) });
  }
}
