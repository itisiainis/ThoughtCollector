// Palette, shading and layout constants. Ported straight from theme.py.

// Auto-assign cycle: orange, blue, red, cyan, green, violet.
// Desaturated to roughly S=40%, L=60% so they sit comfortably under black text.
export const AREA_PALETTE = [
  '#D9A066', // orange
  '#6E92C4', // blue
  '#D18179', // red
  '#5FA8B0', // cyan
  '#7FAD74', // green
  '#9C82C4', // violet
];

export const NEUTRAL_GREY = '#9E9E9E'; // rail dots for Areas / Rogue
export const TASK_CARD = '#E0E0E0'; // grey task card body
export const PAGE_BG = '#ffffff';
export const TEXT_MUTED = '#8A8A8A';
export const RULE_COLOR = '#C9C9C9';
export const ACCENT = '#03A9F4';
export const DANGER = '#C62828';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Shift a hex colour's lightness. amount < 0 darkens, > 0 lightens. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const nl = Math.min(1, Math.max(0, l + amount));
  const c = (1 - Math.abs(2 * nl - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = nl - c / 2;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return (
    '#' +
    rgb
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase(),
      )
      .join('')
  );
}

/** Colour for the Nth area ever created. Cycles through AREA_PALETTE. */
export const paletteAt = (cursor: number) => AREA_PALETTE[cursor % AREA_PALETTE.length];

// Rounded corners belong to the tasks, square ones to the areas: the shape
// that looks pressable is given to the thing you press most.
export const CARD_RADIUS = 10;
/** How long a description takes to open or close. */
export const FOLD_MS = 200;
/** The description's line height. */
export const BODY_LINE_HEIGHT = 19;
/** The name's line height - explicit, so the two-line clip height used while
 * a sibling is dragging can be computed rather than guessed. */
export const NAME_LINE_HEIGHT = 20;

export const CARD_GAP = 7;
export const SECTION_GAP = 14;
/**
 * The rule closing a section sits one card-gap under its last card - the same
 * distance the cards keep from each other - and several of those gaps above the
 * section that follows. The line reads as the end of what is above it rather
 * than as the start of what is below.
 *
 * The three fixed sections at the top are packed tighter than the areas: they
 * are always there, in that order, and do not need to be told apart.
 */
export const RULE_GAP_FIXED = CARD_GAP * 2;
export const RULE_GAP_AREA = CARD_GAP * 3;
export const PAGE_PADDING = 10;

/** Breathing room between a row's trailing content (the chevron, the sort
 * button) and the card/screen edge - independent of whether the rail adds
 * its own width on top. */
export const EDGE_GAP = 10;

export const RAIL_DOT_SIZE = 26;
/** How far the rail sits from the screen edge - styles.rail's own `right`. */
export const RAIL_INSET = 4;
/** The rail's actual footprint from a row's edge: a row that clears this
 * much has cleared the rail, with no gap of its own baked in - whoever pads
 * against it adds their own, so it reads as the same gap as everything else
 * that row keeps clear. */
export const RAIL_WIDTH = RAIL_DOT_SIZE + RAIL_INSET;
export const MAX_AREAS = 8;

export const NAV_HEIGHT = 62;

// ---------------------------------------------------------------- headers

/** How far a pressable tint is pulled toward grey, then darkened. */
export const PRESS_GREY_MIX = 0.42;
export const PRESS_SHIFT = -0.16;

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const channel = (x: number, y: number) =>
    Math.round((x + (y - x) * t) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return '#' + channel(ar, br) + channel(ag, bg) + channel(ab, bb);
}

/**
 * The fill for the parts you press - the + on a section band, the name on a
 * card. The surrounding colour pulled toward grey and darkened, so the target
 * shows up against whatever it sits on without introducing a colour of its own.
 */
export const pressableColor = (base: string) =>
  shade(mix(base, NEUTRAL_GREY, PRESS_GREY_MIX), PRESS_SHIFT);

/** Black or white, whichever stands out on the given fill. */
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? '#000000DE' : '#FFFFFF';
}

// ---------------------------------------------------------------- swipe

/** Fraction of the screen a card must travel left before the trash arms. */
export const SWIPE_LIMIT_FRACTION = 0.4;
/** How much of the finger's movement still lands once past the limit. */
export const SWIPE_RESISTANCE = 0.22;
