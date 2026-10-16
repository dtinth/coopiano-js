import { Synth } from "./synth.ts";
import { attachKeyboard } from "./keyboard.ts";

const $ = (id: string) => document.getElementById(id)!;
const startButton = $("start") as HTMLButtonElement;

// WebMidiLink messages can arrive before audio starts; keep them until the synth exists.
let synth: Synth | undefined;
const pending: number[][] = [];
const send = (data: number[]) => (synth ? synth.send(data) : pending.push(data));

// WebMidiLink level 0: "midi,90,3c,7f" (hex bytes), one MIDI message per postMessage.
window.addEventListener("message", (event) => {
  if (typeof event.data !== "string") return;
  const [kind, ...rest] = event.data.split(",");
  if (kind !== "midi") return;
  const bytes = rest.map((hex) => parseInt(hex, 16));
  if (bytes.length && bytes.every((b) => b >= 0 && b <= 255)) send(bytes);
});

attachKeyboard(window, {
  send,
  onChange: ({ octave, transpose }) => {
    $("keyboard-status").textContent =
      `Octave ${octave}, transpose ${transpose >= 0 ? "+" : ""}${transpose}`;
  },
});

async function start() {
  startButton.disabled = true;
  startButton.textContent = "Starting…";
  const context = new AudioContext({ latencyHint: "interactive" });
  const t = performance.now();
  synth = await Synth.create(context);
  synth.node.connect(context.destination);
  await context.resume();
  for (const data of pending.splice(0)) synth.send(data);
  startButton.hidden = true;
  $("status").hidden = false;
  $("audio-status").textContent =
    `${context.sampleRate} Hz, ready in ${Math.round(performance.now() - t)} ms, ` +
    `output latency ${Math.round((context.outputLatency || context.baseLatency) * 1000)} ms`;
  await startMidi();
}

async function startMidi() {
  const status = $("midi-status");
  if (!navigator.requestMIDIAccess) {
    status.textContent = "Web MIDI is not available in this browser.";
    return;
  }
  status.textContent = "Requesting access…";
  try {
    const access = await navigator.requestMIDIAccess();
    const update = () => {
      const names: string[] = [];
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e) => {
          // Ignore clock, active sensing and other system real-time messages.
          if (e.data && e.data[0] < 0xf0) send(Array.from(e.data));
        };
        names.push(input.name ?? input.id);
      }
      status.textContent = names.length ? names.join(", ") : "No MIDI inputs connected.";
    };
    access.onstatechange = update;
    update();
  } catch (error) {
    status.textContent = `MIDI access failed: ${String(error)}`;
  }
}

startButton.addEventListener("click", () => {
  start().catch((error) => {
    console.error(error);
    startButton.textContent = `Failed: ${String(error)}`;
  });
});
