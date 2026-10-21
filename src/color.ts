const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0xff000000,
  white: 0xffffffff,
  red: 0xffff3b30,
  orange: 0xffff9500,
  yellow: 0xffffcc00,
  green: 0xff34c759,
  mint: 0xff00c7be,
  teal: 0xff30b0c7,
  cyan: 0xff32ade6,
  blue: 0xff007aff,
  indigo: 0xff5856d6,
  purple: 0xffaf52de,
  pink: 0xffff2d55,
  brown: 0xffa2845e,
  gray: 0xff8e8e93,
  grey: 0xff8e8e93,
};

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parse a CSS-ish color into an unsigned ARGB integer (0xAARRGGBB).
 * Supports #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), a small set of names and raw numbers.
 */
export function toArgb(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  const s = input.trim().toLowerCase();
  if (s in NAMED) return NAMED[s]!;

  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    if (/^[0-9a-f]{6}$/.test(hex)) return (0xff000000 | parseInt(hex, 16)) >>> 0;
    if (/^[0-9a-f]{8}$/.test(hex)) {
      const rgb = parseInt(hex.slice(0, 6), 16);
      const a = parseInt(hex.slice(6), 16);
      return ((a << 24) | rgb) >>> 0;
    }
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : Number(parts[3]);
    if ([r, g, b, alpha].every((n) => Number.isFinite(n))) {
      return ((clampByte(alpha * 255) << 24) | (clampByte(r!) << 16) | (clampByte(g!) << 8) | clampByte(b!)) >>> 0;
    }
  }

  throw new Error(`[dynamic-island] Unsupported color "${input}". Use #hex, rgb()/rgba() or a basic color name.`);
}

/** ARGB integer back to an rgba() string for React Native styles. */
export function argbToCss(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}
