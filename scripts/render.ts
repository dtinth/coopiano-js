// Renders a short phrase with the wasm build to a WAV file, as a smoke test.
// Usage: node scripts/render.ts [out.wav] [sampleRate]
import { readFileSync, writeFileSync } from "node:fs";
import { CoopianoCore, MAX_FRAMES } from "../src/core.ts";

const out = process.argv[2] ?? "render.wav";
const rate = Number(process.argv[3] ?? 48000);
const module = new WebAssembly.Module(
  readFileSync(new URL("../src/generated/coopiano.wasm", import.meta.url)),
);

let t = performance.now();
const core = CoopianoCore.create(module, rate);
console.log(
  `create: ${(performance.now() - t).toFixed(0)} ms, latency ${core.latencySamples} frames`,
);

const seconds = 6;
const total = Math.ceil((seconds * rate) / MAX_FRAMES) * MAX_FRAMES;
const left = new Float32Array(total);
const right = new Float32Array(total);
const events: [number, number[]][] = [
  [0, [0xb0, 64, 127]],
  [0, [0x90, 48, 90]],
  [0.5, [0x90, 55, 80]],
  [1, [0x90, 60, 80]],
  [1, [0x90, 64, 80]],
  [1, [0x90, 67, 80]],
  [1, [0x90, 72, 100]],
  [4, [0xb0, 64, 0]],
];
let strikes = 0;
let strikeMs = 0;
t = performance.now();
for (let i = 0; i < total; i += MAX_FRAMES) {
  for (const [time, bytes] of events) {
    if (Math.floor((time * rate) / MAX_FRAMES) === i / MAX_FRAMES) {
      const s = performance.now();
      core.midi(bytes);
      if ((bytes[0] & 0xf0) === 0x90) {
        strikes++;
        strikeMs += performance.now() - s;
      }
    }
  }
  core.process(left.subarray(i), right.subarray(i), 0, MAX_FRAMES);
}
const elapsed = (performance.now() - t) / 1000;
console.log(
  `render: ${elapsed.toFixed(2)} s for ${seconds} s of audio (${(seconds / elapsed).toFixed(1)}x real time)`,
);
console.log(`note-on: ${(strikeMs / strikes).toFixed(2)} ms average over ${strikes} notes`);
let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
console.log(`peak: ${peak.toFixed(3)}`);

const data = Buffer.alloc(44 + total * 4);
data.write("RIFF", 0);
data.writeUInt32LE(36 + total * 4, 4);
data.write("WAVEfmt ", 8);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(2, 22);
data.writeUInt32LE(rate, 24);
data.writeUInt32LE(rate * 4, 28);
data.writeUInt16LE(4, 32);
data.writeUInt16LE(16, 34);
data.write("data", 36);
data.writeUInt32LE(total * 4, 40);
for (let i = 0; i < total; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
}
writeFileSync(out, data);
console.log(`wrote ${out}`);
