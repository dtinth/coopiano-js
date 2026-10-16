// Sliders for the parameters in params.ts. Used by the standalone page and the WAM GUI.
import {
  PARAMETER_IDS,
  PARAMETERS,
  denormalize,
  formatParameter,
  normalize,
  type ParameterId,
  type ParameterValues,
} from "./params.ts";

export interface Controls {
  element: HTMLElement;
  set(values: Partial<ParameterValues>): void;
}

export function createControls(
  values: ParameterValues,
  onChange: (id: ParameterId, value: number) => void,
): Controls {
  const element = document.createElement("div");
  element.className = "coopiano-controls";
  const inputs = new Map<ParameterId, { input: HTMLInputElement; output: HTMLOutputElement }>();
  for (const id of PARAMETER_IDS) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = PARAMETERS[id].label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "any";
    const output = document.createElement("output");
    input.addEventListener("input", () => {
      const value = denormalize(id, Number(input.value));
      output.textContent = formatParameter(id, value);
      onChange(id, value);
    });
    // Double-click resets to the default value.
    input.addEventListener("dblclick", () => {
      const value = PARAMETERS[id].defaultValue;
      set({ [id]: value });
      onChange(id, value);
    });
    label.append(name, input, output);
    element.append(label);
    inputs.set(id, { input, output });
  }
  const set = (update: Partial<ParameterValues>) => {
    for (const [id, { input, output }] of inputs) {
      const value = update[id];
      if (value === undefined) continue;
      input.value = String(normalize(id, value));
      output.textContent = formatParameter(id, value);
    }
  };
  set(values);
  return { element, set };
}

/** Styles for the controls, for pages that do not load style.css (the WAM GUI). */
export const CONTROLS_CSS = `
.coopiano-controls { display: grid; gap: 0.25rem 0.75rem; grid-template-columns: max-content 1fr 5.5em; align-items: center; }
.coopiano-controls label { display: contents; }
.coopiano-controls input { width: 100%; min-width: 6rem; margin: 0; }
.coopiano-controls output { font-variant-numeric: tabular-nums; text-align: right; }
`;
