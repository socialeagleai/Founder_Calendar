import type {
  Box,
  BoardTemplateData,
  MeetingSection,
  MeetingTemplateData,
  Template,
} from "./store";

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export const isBoardData = (t: Template): t is Template & { data: BoardTemplateData } =>
  t.kind === "board";
export const isMeetingData = (t: Template): t is Template & { data: MeetingTemplateData } =>
  t.kind === "meeting";

/**
 * Find the first grid position (left→right, top→bottom) where a new w×h box
 * won't overlap any existing box, so repeated "Add Box" clicks never stack on
 * top of each other. Scans rows unboundedly, so it always returns a slot.
 */
export function nextFreeSlot(boxes: Box[], w = 280, h = 200): { x: number; y: number } {
  const GAP = 24;
  const START_X = 48;
  const START_Y = 48;
  const MAX_X = 1240; // wrap to a new row past this; matches the canvas min width
  const overlaps = (x: number, y: number) =>
    boxes.some(
      (b) =>
        x < b.x + b.width + GAP &&
        x + w + GAP > b.x &&
        y < b.y + b.height + GAP &&
        y + h + GAP > b.y,
    );
  for (let y = START_Y; ; y += h + GAP) {
    for (let x = START_X; x + w <= MAX_X; x += w + GAP) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
}

/** Lay template boxes out in a tidy 3-column grid when applying to a board. */
export function layoutBoxes(boxes: Box[]): Box[] {
  const COLS = 3;
  const W = 280;
  const H = 200;
  const GAP_X = 24;
  const GAP_Y = 24;
  return boxes.map((b, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return {
      ...b,
      width: b.width || W,
      height: b.height || H,
      x: 40 + col * (W + GAP_X),
      y: 40 + row * (H + GAP_Y),
    };
  });
}

/** Fresh ids for sections + items so an applied template never collides with its source. */
export function cloneSections(sections: MeetingSection[]): MeetingSection[] {
  return sections.map((s) => ({
    ...s,
    id: uid(),
    items: s.items.map((it) => ({ ...it, id: uid() })),
  }));
}
