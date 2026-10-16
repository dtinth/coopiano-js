// QWERTY keyboard → MIDI, using the same piano keymap as WebMIDICon:
// https://github.com/dtinth/WebMIDICon/blob/master/src/midi-keybindings/index.ts
//
// - Bottom row (LShift Z S X D C … RShift): B2 to F4 at the default octave.
// - Top rows (` Tab Q 2 W 3 E … and the navigation/numpad keys): A#3 upward.
//   Hold Alt to play the top rows one octave higher.
// - Space: sustain pedal. Left/Right: transpose. Up/Down: octave.
// - Esc, F1–F12: set transpose directly (Esc = −6, F6 = 0, F12 = +6).

// Key codes, with 1000 added for right-side keys and 2000 for numpad keys.
const transposeKeys = [27, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123];
const firstRow = [16, 90, 83, 88, 68, 67, 86, 71, 66, 72, 78, 74, 77, 188, 76, 190, 186, 191, 1016];
const secondRow = [
  192, 9, 81, 50, 87, 51, 69, 82, 53, 84, 54, 89, 55, 85, 73, 57, 79, 48, 80, 219, 187, 221, 8, 220,
  45, 46, 35, 36, 34, 33, 2055, 2056, 2111, 2057, 2106, 2107, 2109,
];

function getKeyCode(event: KeyboardEvent) {
  // macOS does not have the PC "Insert" key; treat "PrintScreen" (F13) as Insert.
  if (event.keyCode === 124) return 45;
  return (event.location === 2 ? 1000 : event.location === 3 ? 2000 : 0) + event.keyCode;
}

export interface KeyboardOptions {
  send: (data: number[]) => void;
  onChange?: (state: { octave: number; transpose: number }) => void;
  channel?: number;
}

export function attachKeyboard(target: Window, options: KeyboardOptions) {
  const { send } = options;
  const channel = options.channel ?? 0;
  const velocity = 0x60;
  let octave = 3;
  let transpose = 0;
  let pedal = false;
  // Physical key → the MIDI note it started, so that key-up releases the right note
  // even if octave/transpose changed while it was held.
  const held = new Map<number, number>();

  const changed = () => options.onChange?.({ octave, transpose });
  const setTranspose = (value: number) => {
    // Keep transpose within -6..+6 and carry whole octaves into `octave`.
    const carry =
      value > 6 ? Math.ceil((value - 6) / 12) : value < -6 ? -Math.ceil((-6 - value) / 12) : 0;
    octave += carry;
    transpose = value - carry * 12;
    changed();
  };

  const noteFor = (keyCode: number, altKey: boolean) => {
    let index = firstRow.indexOf(keyCode);
    if (index > -1) return index + 11 + transpose + octave * 12;
    index = secondRow.indexOf(keyCode);
    if (index > -1) return index + 22 + (altKey ? 12 : 0) + transpose + octave * 12;
    return undefined;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
      return;
    const keyCode = getKeyCode(event);
    const transposeIndex = transposeKeys.indexOf(keyCode);
    if (transposeIndex > -1) {
      event.preventDefault();
      setTranspose(transposeIndex - 6);
      return;
    }
    if (keyCode === 32) {
      event.preventDefault();
      if (!pedal) send([0xb0 | channel, 64, 127]);
      pedal = true;
      return;
    }
    if (keyCode === 37) return (event.preventDefault(), setTranspose(transpose - 1));
    if (keyCode === 39) return (event.preventDefault(), setTranspose(transpose + 1));
    if (keyCode === 38) return (event.preventDefault(), octave++, changed());
    if (keyCode === 40) return (event.preventDefault(), octave--, changed());

    const note = noteFor(keyCode, event.altKey);
    if (note === undefined) return;
    event.preventDefault();
    if (event.repeat || held.has(keyCode) || note < 0 || note > 127) return;
    held.set(keyCode, note);
    send([0x90 | channel, note, velocity]);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const keyCode = getKeyCode(event);
    if (keyCode === 32) {
      if (pedal) send([0xb0 | channel, 64, 0]);
      pedal = false;
      return;
    }
    const note = held.get(keyCode);
    if (note === undefined) return;
    held.delete(keyCode);
    send([0x80 | channel, note, 0x40]);
  };

  // Releasing everything on blur avoids stuck notes when focus moves away mid-chord.
  const onBlur = () => {
    for (const note of held.values()) send([0x80 | channel, note, 0x40]);
    held.clear();
    if (pedal) send([0xb0 | channel, 64, 0]);
    pedal = false;
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  changed();
  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}
