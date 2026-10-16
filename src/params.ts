// Parameters that can change while the piano plays. The WAM build exposes them as
// WAM parameters (with the same ids); the standalone page shows them as sliders.
// Volume and the reverb change coopiano's output stage in place (wasm/live_params.hpp).
// Velocity curve and stereo width are applied in JavaScript.

export interface ParameterConfig {
  label: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  units: string;
  /** WAM exponent: the slider position x maps to min + x^(1.5^exponent) * (max - min). */
  exponent: number;
  /** Decimal places to show. */
  decimals: number;
}

export const PARAMETERS = {
  volume: {
    label: "Volume",
    defaultValue: 0,
    minValue: -40,
    maxValue: 6,
    units: "dB",
    exponent: 0,
    decimals: 1,
  },
  reverbMix: {
    label: "Reverb",
    defaultValue: 0.3,
    minValue: 0,
    maxValue: 1,
    units: "",
    exponent: 0,
    decimals: 2,
  },
  reverbDecay: {
    label: "Reverb decay",
    defaultValue: 1.1,
    minValue: 0.2,
    maxValue: 4,
    units: "s",
    exponent: 1,
    decimals: 2,
  },
  reverbDamping: {
    label: "Reverb brightness",
    defaultValue: 5500,
    minValue: 500,
    maxValue: 12000,
    units: "Hz",
    exponent: 2,
    decimals: 0,
  },
  velocityCurve: {
    label: "Velocity curve",
    defaultValue: 1,
    minValue: 0.5,
    maxValue: 2,
    units: "",
    exponent: 0,
    decimals: 2,
  },
  stereoWidth: {
    label: "Stereo width",
    defaultValue: 1,
    minValue: 0,
    maxValue: 2,
    units: "",
    exponent: 0,
    decimals: 2,
  },
} satisfies Record<string, ParameterConfig>;

export type ParameterId = keyof typeof PARAMETERS;
export type ParameterValues = Record<ParameterId, number>;
export const PARAMETER_IDS = Object.keys(PARAMETERS) as ParameterId[];

export function defaultParameterValues(): ParameterValues {
  return Object.fromEntries(
    PARAMETER_IDS.map((id) => [id, PARAMETERS[id].defaultValue]),
  ) as ParameterValues;
}

// The same mapping as the WAM SDK's WamParameterInfo, so slider positions agree.
export function denormalize(id: ParameterId, x: number) {
  const { minValue, maxValue, exponent } = PARAMETERS[id];
  return minValue + x ** (1.5 ** exponent) * (maxValue - minValue);
}
export function normalize(id: ParameterId, value: number) {
  const { minValue, maxValue, exponent } = PARAMETERS[id];
  return ((value - minValue) / (maxValue - minValue) || 0) ** (1.5 ** -exponent);
}

export function formatParameter(id: ParameterId, value: number) {
  const { decimals, units } = PARAMETERS[id];
  return `${value.toFixed(decimals)}${units ? ` ${units}` : ""}`;
}

/** Velocity curve: above 1, the same touch plays softer; below 1, louder. */
export function curveVelocity(velocity: number, curve: number) {
  if (curve === 1) return velocity;
  return Math.min(127, Math.max(1, Math.round(127 * (velocity / 127) ** curve)));
}
