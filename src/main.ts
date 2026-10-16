import { Synth } from "./synth.ts";
import { attachKeyboard } from "./keyboard.ts";
import { createControls } from "./controls.ts";
import { createPianoView } from "./piano-view.ts";
import { PARAMETER_IDS, PARAMETERS, defaultParameterValues } from "./params.ts";

const $ = (id: string) => document.getElementById(id)!;
const startButton = $("start") as HTMLButtonElement;

// Sound settings, kept in this browser.
const STORAGE_KEY = "coopiano-parameters";
const parameters = defaultParameterValues();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
  for (const id of PARAMETER_IDS) {
    const value = saved[id];
    const { minValue, maxValue } = PARAMETERS[id];
    if (typeof value === "number" && value >= minValue && value <= maxValue) parameters[id] = value;
  }
} catch {
  // Storage is not available. Use the defaults.
}
const controls = createControls(parameters, (id, value) => {
  parameters[id] = value;
  synth?.setParameters({ [id]: value });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parameters));
  } catch {
    // Storage is not available. The setting applies until the page closes.
  }
});
$("controls").append(controls.element);

// MIDI from all inputs goes through play(). Messages that arrive before audio starts
// (for example from a WebMidiLink host) are kept until the synth exists.
let synth: Synth | undefined;
const pending: number[][] = [];
const show = createPianoView($("piano"), (bytes) => play(bytes));
function play(data: number[]) {
  show(data);
  if ((data[0] & 0xf0) === 0xb0 && data[1] === 64) {
    $("pedal-status").textContent = data[2] >= 64 ? "Down" : "Up";
  }
  if (synth) synth.send(data);
  else pending.push(data);
}

// WebMidiLink level 0: "midi,90,3c,7f" (hex bytes), one MIDI message per postMessage.
window.addEventListener("message", (event) => {
  if (typeof event.data !== "string") return;
  const [kind, ...rest] = event.data.split(",");
  if (kind !== "midi") return;
  const bytes = rest.map((hex) => parseInt(hex, 16));
  if (bytes.length && bytes.every((b) => b >= 0 && b <= 255)) play(bytes);
});

attachKeyboard(window, {
  send: play,
  onChange: ({ octave, transpose }) => {
    $("keyboard-status").textContent =
      `Octave ${octave}, transpose ${transpose >= 0 ? "+" : ""}${transpose}`;
  },
});

// Browsers allow audio only after a user gesture. Any key or click on the page starts it.
let starting: Promise<void> | undefined;
const startOnce = () => {
  starting ??= start().catch((error) => {
    console.error(error);
    startButton.hidden = false;
    startButton.disabled = false;
    startButton.textContent = `Failed: ${String(error)}. Try again`;
    $("audio-status").textContent = "Failed to start";
    starting = undefined;
  });
};

async function start() {
  startButton.disabled = true;
  startButton.textContent = "Starting…";
  $("audio-status").textContent = "Starting…";
  const context = new AudioContext({ latencyHint: "interactive" });
  const t = performance.now();
  const created = await Synth.create(context);
  created.setParameters(parameters);
  created.node.connect(context.destination);
  await context.resume();
  synth = created;
  for (const data of pending.splice(0)) synth.send(data);
  startButton.hidden = true;
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
          if (e.data && e.data[0] < 0xf0) play(Array.from(e.data));
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

startButton.addEventListener("click", startOnce);
for (const type of ["pointerdown", "keydown"] as const) {
  window.addEventListener(type, startOnce, { capture: true });
}
