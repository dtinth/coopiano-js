// An 88-key on-screen keyboard. It shows the notes that sound, and plays notes on
// mouse and touch input.
const FIRST = 21;
const LAST = 108;
const isBlack = (note: number) => [1, 3, 6, 8, 10].includes(note % 12);

export function createPianoView(
  container: HTMLElement,
  play: (bytes: number[]) => void,
): (bytes: ArrayLike<number>) => void {
  const whiteCount = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i).filter(
    (n) => !isBlack(n),
  ).length;
  const width = 100 / whiteCount;
  const keys = new Map<number, HTMLElement>();
  const held = new Map<number, number>();
  let white = 0;
  for (let note = FIRST; note <= LAST; note++) {
    const key = document.createElement("div");
    key.dataset.note = String(note);
    if (isBlack(note)) {
      key.className = "key black";
      key.style.left = `${(white - 0.3) * width}%`;
      key.style.width = `${width * 0.6}%`;
    } else {
      key.className = "key white";
      key.style.left = `${white * width}%`;
      key.style.width = `${width}%`;
      white++;
    }
    container.append(key);
    keys.set(note, key);
  }

  // One pointer plays one note at a time. Sliding to another key moves the note.
  const pointers = new Map<number, number>();
  const release = (pointerId: number) => {
    const note = pointers.get(pointerId);
    if (note === undefined) return;
    pointers.delete(pointerId);
    play([0x80, note, 0]);
  };
  const press = (pointerId: number, target: EventTarget | null) => {
    const note = Number((target as HTMLElement | null)?.dataset?.note);
    if (!note || pointers.get(pointerId) === note) return;
    release(pointerId);
    pointers.set(pointerId, note);
    play([0x90, note, 0x60]);
  };
  container.addEventListener("pointerdown", (e) => {
    container.releasePointerCapture(e.pointerId);
    press(e.pointerId, e.target);
  });
  container.addEventListener("pointerover", (e) => {
    if (pointers.has(e.pointerId)) press(e.pointerId, e.target);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
    container.addEventListener(type, (e) => release(e.pointerId));
  }

  // Shows note-on and note-off from all inputs.
  return (bytes) => {
    const status = bytes[0] & 0xf0;
    const note = bytes[1];
    if (status !== 0x80 && status !== 0x90) {
      if (status === 0xb0 && (bytes[1] === 120 || bytes[1] === 123)) {
        held.clear();
        for (const key of keys.values()) key.classList.remove("down");
      }
      return;
    }
    const count = Math.max(0, (held.get(note) ?? 0) + (status === 0x90 && bytes[2] > 0 ? 1 : -1));
    held.set(note, count);
    keys.get(note)?.classList.toggle("down", count > 0);
  };
}
