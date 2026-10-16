// Web Worker that runs the hammer contact simulation for the audio thread.
// Setup message: { wasm: ArrayBuffer }. Then each message carries a MessagePort to a
// processor; requests arrive on that port and results go back on it.
// Requests for notes being played go before background (prewarm) requests.
import { ContactProducer } from "../core.ts";
import type { ContactRequest } from "./scheduler.ts";

let producer: ContactProducer | undefined;
const urgent: [MessagePort, ContactRequest][] = [];
const background: [MessagePort, ContactRequest][] = [];
let scheduled = false;

// One request per task, so that new urgent requests can overtake background ones.
const pump = () => {
  scheduled = false;
  const next = urgent.shift() ?? background.shift();
  if (!next || !producer) return;
  const [port, { key, velocity }] = next;
  const data = producer.compute(key, velocity);
  port.postMessage(data, [data.buffer]);
  schedule();
};
const tick = new MessageChannel();
tick.port1.onmessage = pump;
const schedule = () => {
  if (scheduled || (!urgent.length && !background.length)) return;
  scheduled = true;
  tick.port2.postMessage(null);
};

self.onmessage = (e: MessageEvent<{ wasm?: ArrayBuffer; port?: MessagePort }>) => {
  if (e.data.wasm) producer = new ContactProducer(new WebAssembly.Module(e.data.wasm));
  const port = e.data.port;
  if (port) {
    port.onmessage = (m: MessageEvent<ContactRequest>) => {
      (m.data.background ? background : urgent).push([port, m.data]);
      schedule();
    };
  }
};
