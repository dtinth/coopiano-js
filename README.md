# coopiano-js

[Peter Cooper's coopiano](https://github.com/peterc/coopiano), a physically modelled piano, compiled to WebAssembly. It runs in the browser in three ways:

- **Standalone web app** (`index.html`). Plays from Web MIDI inputs and from the computer keyboard, with the [WebMIDICon piano keymap](https://github.com/dtinth/WebMIDICon/blob/master/src/midi-keybindings/index.ts).
- **[WebMidiLink](https://www.g200kg.com/en/docs/webmidilink/) synth** (the same `index.html`). Accepts Level 0 `midi,…` messages through `postMessage`.
- **[Web Audio Module 2](https://www.webaudiomodules.com/) instrument** (`wam/index.js`). Load this URL in a WAM host. `wam-host.html` is a minimal test host.

Status: spike. See [#1](https://github.com/dtinth/coopiano-js/issues/1).

## How it works

- `coopiano/` is a git submodule. Its source is not changed.
- `wasm/coopiano_wasm.cpp` is a small C API around `instrument::Engine` and `piano_host::Adapter`. The adapter resamples from the engine's 44.1 kHz to the host rate (44.1, 48, 88.2 or 96 kHz).
- `wasm/build.sh` compiles it with Emscripten as a standalone wasm module (about 150 KB, 70 KB gzipped). It has no Emscripten JavaScript glue. It imports only 4 stub functions, so it runs inside `AudioWorkletGlobalScope`.
- Note-on cost is moved off the audio thread. coopiano prepares a strike in two stages. The first stage, the hammer contact simulation, is 90–99% of the cost (up to about 5 ms for a soft low bass note). It depends only on the key and the velocity. A pool of Web Workers (`src/worklet/contact-worker.ts`) runs this stage and sends the result (1–10 KB) to the audio thread. There, `wasm/contact_cache.hpp` keeps it in a cache and runs the second stage (about 0.1 ms). The output is bit-identical to the normal path. At startup, the workers compute the 88 keys at the computer keyboard's velocity. A note whose result is not cached waits for a worker. A 10-note chord at new velocities waited at most 12 ms in Chrome with 4 workers.
- `src/core.ts` wraps the wasm exports. Both AudioWorklet processors use it:
  - `src/worklet/processor.ts`: for the standalone app and WebMidiLink. MIDI comes through the node's `port`.
  - `src/worklet/wam-processor.ts`: extends the WAM SDK's `WamProcessor`. MIDI is sample-accurate.

## Development

Requires [mise](https://mise.jdx.dev/) (for Emscripten) and [Vite+](https://viteplus.dev/).

```sh
git submodule update --init
mise install
./wasm/build.sh
vp install
vp dev
```

**Smoke test** (renders a short phrase with the wasm build in Node.js, with and without the contact cache. It prints the worst audio-thread time per render quantum, and fails if the two renders differ):

```sh
node scripts/render.ts render.wav 48000
```

**Production build:**

```sh
vp check
vp build
```

## Known limits

- The first time a key is played at a given velocity, the note waits for a worker: a few ms, up to about 12 ms for a large chord with low bass notes. Then the result stays in the cache. The cache for all 88 × 127 combinations would take about 72 MiB.
- In an `OfflineAudioContext`, no workers are used, and strikes are prepared on the rendering thread.
- No parameters or presets are exposed yet. The sound uses coopiano's built-in defaults (the same as `default.ini`).
- Only CC64 (sustain pedal) and CC120/CC123 (all sound off) are handled, in addition to note on/off.

## License

coopiano is MIT-licensed. See [coopiano/LICENSE](https://github.com/peterc/coopiano/blob/main/LICENSE).
