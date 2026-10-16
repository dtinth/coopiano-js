// Main-thread side: starts the contact workers and connects them to an AudioWorkletNode.
// The worker is inlined (a blob URL), so that it also starts when a WAM host on another
// origin loads this module; browsers block workers from cross-origin script URLs.
import ContactWorker from "./worklet/contact-worker.ts?worker&inline";
import type { ContactPortMessage } from "./worklet/scheduler.ts";

let workers: Worker[] | undefined;

/** One shared pool per page. Each worker holds its own wasm instance. */
function getWorkers(wasm: ArrayBuffer): Worker[] {
  if (!workers) {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    workers = Array.from({ length: count }, () => {
      const worker = new ContactWorker();
      worker.postMessage({ wasm });
      return worker;
    });
  }
  return workers;
}

export function connectContactWorkers(node: AudioWorkletNode, wasm: ArrayBuffer) {
  // Offline rendering runs faster than real time, so notes would wait for the workers
  // and start late. Without workers, the processor prepares strikes inline, which is
  // what offline rendering wants.
  if (typeof OfflineAudioContext !== "undefined" && node.context instanceof OfflineAudioContext)
    return;
  for (const worker of getWorkers(wasm)) {
    const channel = new MessageChannel();
    worker.postMessage({ port: channel.port1 }, [channel.port1]);
    node.port.postMessage(
      { type: "coopiano-contact-port", port: channel.port2 } satisfies ContactPortMessage,
      [channel.port2],
    );
  }
}
