// AudioWorklet processor for the Web Audio Module 2 build. It extends the SDK's
// WamProcessor, which WamNode.addModules() has already put in the module scope.
// WamProcessor splits each render quantum at event times, so MIDI is sample-accurate.
import { CoopianoCore } from "../core.ts";
import { PARAMETER_IDS, PARAMETERS } from "../params.ts";
import { WAM_MODULE_ID } from "../wam/id.ts";
import { NoteScheduler } from "./scheduler.ts";

type WamProcessorBase = new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor & {
  /** Per-sample parameter values for the current render quantum. */
  readonly _parameterInterpolators: Record<string, { values: Float32Array }>;
};
type WamParameterInfo = new (id: string, config: object) => object;
const scope = globalThis as unknown as {
  webAudioModules: {
    getModuleScope(id: string): {
      WamProcessor: WamProcessorBase;
      WamParameterInfo: WamParameterInfo;
    };
  };
  coopianoWamRegistered?: boolean;
};

// addModule() runs this file again for every new instance; register the name once.
if (!scope.coopianoWamRegistered) {
  scope.coopianoWamRegistered = true;
  const { WamProcessor, WamParameterInfo } = scope.webAudioModules.getModuleScope(WAM_MODULE_ID);

  class CoopianoWamProcessor extends WamProcessor {
    private readonly core: CoopianoCore;
    private readonly scheduler: NoteScheduler;

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      const { wasm } = options.processorOptions as { wasm: ArrayBuffer };
      this.core = CoopianoCore.create(new WebAssembly.Module(wasm), sampleRate);
      this.scheduler = new NoteScheduler(this.core);
      // WamProcessor owns the port; take the contact-worker ports before it sees them.
      const wamOnMessage = this.port.onmessage!;
      this.port.onmessage = (e) => {
        if (!this.scheduler.handleNodeMessage(e.data)) wamOnMessage.call(this.port, e);
      };
    }

    _generateWamParameterInfo() {
      return Object.fromEntries(
        PARAMETER_IDS.map((id) => {
          const { label, defaultValue, minValue, maxValue, units, exponent } = PARAMETERS[id];
          const config = {
            type: "float",
            label,
            defaultValue,
            minValue,
            maxValue,
            units,
            exponent,
          };
          return [id, new WamParameterInfo(id, config)];
        }),
      );
    }

    _onMidi(midiData: { bytes: number[] }) {
      this.scheduler.midi(midiData.bytes);
    }

    _process(
      startSample: number,
      endSample: number,
      _inputs: Float32Array[][],
      outputs: Float32Array[][],
    ) {
      for (const id of PARAMETER_IDS) {
        this.core.setParameter(id, this._parameterInterpolators[id].values[startSample]);
      }
      const [left, right] = outputs[0];
      this.core.process(left, right, startSample, endSample - startSample);
    }

    destroy() {
      this.core.destroy();
      (WamProcessor.prototype as unknown as { destroy(): void }).destroy.call(this);
    }
  }

  registerProcessor(WAM_MODULE_ID, CoopianoWamProcessor);
}
