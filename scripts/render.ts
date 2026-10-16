// Smoke test and benchmark for the wasm build, in Node.js.
// Renders the same phrase twice:
//   - "inline": each note-on runs the full strike preparation (as on the audio thread before)
//   - "cached": contact responses come from a ContactProducer (in the browser, a Worker),
//     so the audio thread only runs the cheap second stage.
// Prints the audio-thread time of the worst render quantum for each, checks that both
// renders are identical, and writes the cached render to a WAV file.
// Usage: node scripts/render.ts [out.wav] [sampleRate]
import { readFileSync, writeFileSync } from "node:fs";
import { ContactProducer, CoopianoCore, MAX_FRAMES } from "../src/core.ts";

const out = process.argv[2] ?? "render.wav";
const rate = Number(process.argv[3] ?? 48000);
const module = new WebAssembly.Module(
  readFileSync(new URL("../src/generated/coopiano.wasm", import.meta.url)),
);

// [time in seconds, MIDI bytes]
const events: [number, number[]][] = [
  [0, [0xb0, 64, 127]],
  [0, [0x90, 28, 40]],
  [0, [0x90, 40, 50]],
  [0.5, [0x90, 47, 60]],
  [1, [0x90, 52, 70]],
  [1, [0x90, 55, 70]],
  [1, [0x90, 59, 70]],
  [1, [0x90, 64, 80]],
  [1, [0x90, 67, 80]],
  [1, [0x90, 71, 80]],
  [1, [0x90, 76, 100]],
  [4, [0xb0, 64, 0]],
];
const seconds = 6;
const total = Math.ceil((seconds * rate) / MAX_FRAMES) * MAX_FRAMES;

function render(mode: "inline" | "cached") {
  let t = performance.now();
  const core = CoopianoCore.create(module, rate);
  const setup = performance.now() - t;
  if (mode === "cached") {
    const producer = new ContactProducer(module);
    for (const [, bytes] of events) {
      if ((bytes[0] & 0xf0) === 0x90)
        core.installContact(producer.compute(core.contactKey(bytes[1]), bytes[2]));
    }
  }
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let worstQuantum = 0;
  t = performance.now();
  for (let i = 0; i < total; i += MAX_FRAMES) {
    const start = performance.now();
    for (const [time, bytes] of events) {
      if (Math.floor((time * rate) / MAX_FRAMES) !== i / MAX_FRAMES) continue;
      const [status, key, velocity] = bytes;
      if ((status & 0xf0) === 0xb0) core.pedal(status & 0x0f, velocity / 127);
      else if (mode === "inline") core.noteOn(key, velocity, 0);
      else if (core.noteOnCached(key, velocity, 0) !== 1) throw new Error(`not cached: ${key}`);
    }
    core.process(left.subarray(i), right.subarray(i), 0, MAX_FRAMES);
    worstQuantum = Math.max(worstQuantum, performance.now() - start);
  }
  const elapsed = (performance.now() - t) / 1000;
  console.log(
    `${mode}: setup ${setup.toFixed(0)} ms, ${(seconds / elapsed).toFixed(1)}x real time, ` +
      `worst quantum ${worstQuantum.toFixed(2)} ms (budget ${((MAX_FRAMES / rate) * 1000).toFixed(2)} ms)`,
  );
  return { left, right };
}

const inline = render("inline");
const cached = render("cached");
let peak = 0;
let diff = 0;
for (let i = 0; i < total; i++) {
  peak = Math.max(peak, Math.abs(cached.left[i]), Math.abs(cached.right[i]));
  diff = Math.max(
    diff,
    Math.abs(cached.left[i] - inline.left[i]),
    Math.abs(cached.right[i] - inline.right[i]),
  );
}
console.log(`peak: ${peak.toFixed(3)}, max difference between inline and cached: ${diff}`);
if (diff !== 0) process.exitCode = 1;

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
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, cached.left[i])) * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, cached.right[i])) * 32767), 46 + i * 4);
}
writeFileSync(out, data);
console.log(`wrote ${out}`);
