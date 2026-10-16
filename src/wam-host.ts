// Minimal WAM 2 host for testing the plugin, written the way third-party hosts load plugins:
// dynamic import() of the plugin URL, then createInstance() inside an SDK host group.
import { initializeWamHost } from "@webaudiomodules/sdk";
import type { WamNode, WebAudioModule } from "@webaudiomodules/api";
import { attachKeyboard } from "./keyboard.ts";

const $ = (id: string) => document.getElementById(id)!;
const urlInput = $("url") as HTMLInputElement;
const loadButton = $("load") as HTMLButtonElement;
const status = $("status");
urlInput.value = new URL(
  import.meta.env.DEV ? "./src/wam/index.ts" : "./wam/index.js",
  location.href,
).href;

let node: WamNode | undefined;
let context: AudioContext | undefined;
const send = (bytes: number[]) =>
  node?.scheduleEvents({
    type: "wam-midi",
    time: context!.currentTime,
    data: { bytes: bytes as [number, number, number] },
  });

attachKeyboard(window, { send });

async function load() {
  loadButton.disabled = true;
  context ??= new AudioContext({ latencyHint: "interactive" });
  await context.resume();
  const [groupId] = await initializeWamHost(context);
  status.textContent = "Loading…";
  const t = performance.now();
  const { default: Plugin } = (await import(/* @vite-ignore */ urlInput.value)) as {
    default: {
      createInstance(groupId: string, context: BaseAudioContext): Promise<WebAudioModule>;
    };
  };
  const instance = await Plugin.createInstance(groupId, context);
  node?.disconnect();
  node?.destroy();
  node = instance.audioNode;
  node.connect(context.destination);
  const gui = $("gui");
  gui.replaceChildren(await instance.createGui());
  status.textContent = `Loaded ${instance.descriptor.name} in ${Math.round(performance.now() - t)} ms at ${context.sampleRate} Hz. Play with the computer keyboard or a MIDI device.`;
  loadButton.disabled = false;

  const access = await navigator.requestMIDIAccess?.().catch(() => undefined);
  for (const input of access?.inputs.values() ?? []) {
    input.onmidimessage = (e) => {
      if (e.data && e.data[0] < 0xf0) send(Array.from(e.data));
    };
  }
}

loadButton.addEventListener("click", () => {
  load().catch((error) => {
    console.error(error);
    status.textContent = `Failed: ${String(error)}`;
    loadButton.disabled = false;
  });
});
