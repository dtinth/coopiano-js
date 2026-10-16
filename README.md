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

**Smoke test** (renders a short phrase with the wasm build in Node.js, and prints timings):

```sh
node scripts/render.ts render.wav 48000
```

**Production build:**

```sh
vp check
vp build
```

## Known limits

- Each note-on prepares the hammer strike on the audio thread. This takes about 1.3 ms for each note (measured in Node.js on an arm64 server). A render quantum at 48 kHz is 2.7 ms. Thus a large chord can cause an audio dropout. coopiano can build a strike cache instead, but it takes about 15 s and 72 MiB.
- No parameters or presets are exposed yet. The sound uses coopiano's built-in defaults (the same as `default.ini`).
- Only CC64 (sustain pedal) and CC120/CC123 (all sound off) are handled, in addition to note on/off.

## License

coopiano is MIT-licensed. See [coopiano/LICENSE](https://github.com/peterc/coopiano/blob/main/LICENSE).
