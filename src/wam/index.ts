// Web Audio Module 2 entry point. Hosts import this module and call
// `default.createInstance(groupId, audioContext)`.
import { WamNode, WebAudioModule } from "@webaudiomodules/sdk";
import processorUrl from "../worklet/wam-processor.ts?worker&url";
import wasmUrl from "../generated/coopiano.wasm?url";
import { WAM_MODULE_ID } from "./id.ts";
import { connectContactWorkers } from "../contact-workers.ts";

class CoopianoNode extends WamNode {
  static override async addModules(audioContext: BaseAudioContext, moduleId: string) {
    await super.addModules(audioContext, moduleId);
    await audioContext.audioWorklet.addModule(new URL(processorUrl, import.meta.url));
  }
}

let wasmPromise: Promise<ArrayBuffer> | undefined;

export default class CoopianoWam extends WebAudioModule<WamNode> {
  constructor(groupId: string, audioContext: BaseAudioContext) {
    super(groupId, audioContext);
    Object.assign(this.descriptor, {
      identifier: WAM_MODULE_ID,
      name: "coopiano",
      vendor: "dtinth",
      description: "Peter Cooper's coopiano physically modelled piano, compiled to WebAssembly.",
      version: "0.0.0",
      apiVersion: "2.0.0",
      keywords: ["piano", "instrument", "physical modelling"],
      isInstrument: true,
      website: "https://github.com/dtinth/coopiano-js",
      hasAudioInput: false,
      hasAudioOutput: true,
      hasAutomationInput: false,
      hasAutomationOutput: false,
      hasMidiInput: true,
      hasMidiOutput: false,
      hasMpeInput: false,
      hasMpeOutput: false,
      hasOscInput: false,
      hasOscOutput: false,
      hasSysexInput: false,
      hasSysexOutput: false,
    });
  }

  async createAudioNode() {
    wasmPromise ??= fetch(new URL(wasmUrl, import.meta.url)).then((r) => r.arrayBuffer());
    const [wasm] = await Promise.all([
      wasmPromise,
      CoopianoNode.addModules(this.audioContext, this.moduleId),
    ]);
    const node = new CoopianoNode(this, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm },
    });
    await node._initialize();
    connectContactWorkers(node, wasm);
    return node;
  }

  async createGui() {
    const div = document.createElement("div");
    div.style.cssText =
      "padding:12px 16px;font:14px system-ui,sans-serif;background:#222;color:#eee;border-radius:6px;width:240px";
    div.innerHTML = "<strong>coopiano</strong><br>Physically modelled piano. Send it MIDI.";
    return div;
  }
}
