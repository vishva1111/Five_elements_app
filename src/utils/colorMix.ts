// ─── Color Mixing Utilities ───────────────────────────────────────────────────
// Used ONLY by the Dashboard (Home) screen to render multi-color progress rings
// whose color mix depends on the project count and live task progress.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => {
    const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
    return s.length === 1 ? '0' + s : s;
  };
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend between two hex colors. t = 0 → a, t = 1 → b. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  return rgbToHex({ r: lerp(ca.r, cb.r), g: lerp(ca.g, cb.g), b: lerp(ca.b, cb.b) });
}

/**
 * Builds a palette of colors sampled evenly through the given gradient stops.
 * More projects → more steps → a richer color mix on the ring.
 * Steps are clamped between 3 and 10 so the ring always stays readable.
 */
export function buildProgressPalette(stops: string[], projectCount: number): string[] {
  const a = stops[0] ?? '#1a5c2a';
  const b = stops[stops.length - 1] ?? a;
  const safeStops = stops.length >= 2 ? stops : [a, b];
  const steps = Math.max(3, Math.min(10, 2 + Math.max(0, projectCount)));

  if (steps <= safeStops.length) {
    return safeStops.slice(0, steps);
  }

  const colors: string[] = [];
  const span = safeStops.length - 1;
  for (let i = 0; i < steps; i++) {
    const t = span * (i / Math.max(1, steps - 1)); // 0..span (fractional allowed)
    const idx = Math.min(span, t);
    const lo = Math.floor(idx);
    const hi = Math.min(span, lo + 1);
    colors.push(mixColors(safeStops[lo], safeStops[hi], idx - lo));
  }
  return colors;
}

// ─── Project Count → Distinct Colors ──────────────────────────────────────────

/** HSL → hex. h ∈ [0,360), s/l ∈ [0,100]. */
function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) => {
    const c = Math.round(v * 255).toString(16);
    return c.length === 1 ? '0' + c : c;
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Builds a palette where EVERY project gets its own distinct color.
 * The ring then shows exactly `projectCount` mixed segments — so the total
 * project count is visible through the color mixing itself.
 * 0/1 project → a single brand green; capped at 10 segments for readability.
 */
export function buildProjectPalette(projectCount: number): string[] {
  const count = Math.max(0, Math.min(10, projectCount));
  if (count <= 1) return ['#2e7d43'];
  // Start at green (hue 135) and spread evenly around the color wheel so each
  // project gets a clearly different color from its neighbor.
  const SAT = 60;
  const LGT = 48;
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(hslToHex(135 + (i * 360) / count, SAT, LGT));
  }
  return colors;
}

// ─── Smooth Gradient Ramp ─────────────────────────────────────────────────────

/**
 * Expands a palette into a fine, evenly-spaced color ramp.
 * Rendering this ramp with many thin arc segments makes the ring look like a
 * SMOOTH GRADIENT (colors melt into each other) instead of hard color blocks —
 * and the first-to-last colors still follow the given palette order.
 */
export function smoothPalette(colors: string[], steps = 48): string[] {
  const a = colors[0] ?? '#1a5c2a';
  const safe = colors.length >= 2 ? colors : [a, a];
  if (steps <= safe.length) return safe.slice(0, steps);

  const span = safe.length - 1;
  const ramp: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = span * (i / (steps - 1));
    const idx = Math.min(span, t);
    const lo = Math.floor(idx);
    const hi = Math.min(span, lo + 1);
    ramp.push(mixColors(safe[lo], safe[hi], idx - lo));
  }
  return ramp;
}