/**
 * Wire format shared by JS, the iOS widget extension (SwiftUI) and Android (Views / RemoteViews).
 *
 * Keys are deliberately short: on iOS the whole payload travels inside the Live Activity
 * ContentState, which ActivityKit caps at 4 KB. Every native renderer must accept exactly
 * this shape — see docs/SCHEMA.md for the human-readable version.
 *
 * Normalisation rules (done in JS by `serialize`, so native code never has to guess):
 *  - colors are unsigned 32-bit ARGB integers (0xAARRGGBB)
 *  - padding `p` is always [top, right, bottom, left]
 *  - times are epoch milliseconds
 */

export const SCHEMA_VERSION = 1;

/** 's' = start/leading/top, 'c' = center, 'e' = end/trailing/bottom */
export type WireAlign = 's' | 'c' | 'e';
export type WireWeight = 'ul' | 'l' | 'r' | 'm' | 'sb' | 'b' | 'h';

export interface WireMods {
  /** padding [top, right, bottom, left] */
  p?: [number, number, number, number];
  /** background color (ARGB) */
  bg?: number;
  /** corner radius applied to the background / clip */
  r?: number;
  /** fixed width / height */
  w?: number;
  h?: number;
  /** fill: expand to all available space on the main axis of the parent (maxWidth/maxHeight infinity, weight 1) */
  fx?: 1;
  /** opacity 0..1 */
  o?: number;
}

export interface WireStack extends WireMods {
  t: 'v' | 'h' | 'z';
  c: WireNode[];
  /** spacing between children */
  sp?: number;
  /** cross-axis alignment (z: both axes) */
  a?: WireAlign;
}

export interface WireText extends WireMods {
  t: 'tx';
  v: string;
  fs?: number;
  fw?: WireWeight;
  fc?: number;
  /** max lines */
  ln?: number;
  ta?: WireAlign;
  /** monospaced digits */
  mo?: 1;
  /** rounded font design */
  rd?: 1;
}

export interface WireIcon extends WireMods {
  t: 'ic';
  /** iOS: SF Symbol name (falls back to an asset of the same name). Android: built-in alias, see BUILTIN_ICONS */
  n: string;
  /** Android drawable resource name override */
  an?: string;
  s?: number;
  fc?: number;
}

export interface WireImage extends WireMods {
  t: 'im';
  /** asset name: iOS widget asset catalog / Android drawable */
  n: string;
  /** content mode: fill (default) / fit */
  cm?: 'fill' | 'fit';
}

export interface WireSpacer extends WireMods {
  t: 'sp';
  /** min length */
  s?: number;
}

export interface WireProgress extends WireMods {
  t: 'pg';
  /** kind: linear bar or ring */
  k: 'bar' | 'ring';
  /** static value 0..1 (ignored when f+e present) */
  v?: number;
  /** time-based progress: start / end epoch ms — animates natively without updates */
  f?: number;
  e?: number;
  fc?: number;
  /** track color */
  tc?: number;
  /** ring diameter */
  s?: number;
  /** line width */
  lw?: number;
}

export interface WireTimer extends WireMods {
  t: 'tm';
  /** countdown target (epoch ms). When absent, counts up from `f`. */
  e?: number;
  f?: number;
  fs?: number;
  fw?: WireWeight;
  fc?: number;
  ta?: WireAlign;
  rd?: 1;
}

export type WireNode = WireStack | WireText | WireIcon | WireImage | WireSpacer | WireProgress | WireTimer;

export interface WirePayload {
  v: typeof SCHEMA_VERSION;
  /** lock screen / notification banner (iOS) — expanded notification (Android) */
  ls?: WireNode;
  /** Dynamic Island expanded regions */
  ex?: { l?: WireNode; t?: WireNode; c?: WireNode; b?: WireNode };
  /** Dynamic Island compact */
  cp?: { l?: WireNode; t?: WireNode };
  /** Dynamic Island minimal (when several activities compete) */
  mn?: WireNode;
  /** Android collapsed notification row (defaults to a compact row built from cp) */
  nc?: WireNode;
  st?: {
    /** lock screen / notification background */
    bg?: number;
    /** island keyline tint */
    kl?: number;
    /** default text color */
    fc?: number;
  };
  /** deep link opened when the activity is tapped */
  url?: string;
}

/** Cross-platform icon aliases. iOS maps to SF Symbols, Android to drawables bundled with the library. */
export const BUILTIN_ICONS = {
  play: 'play.fill',
  pause: 'pause.fill',
  stop: 'stop.fill',
  forward: 'forward.fill',
  backward: 'backward.fill',
  music: 'music.note',
  phone: 'phone.fill',
  'phone-down': 'phone.down.fill',
  mic: 'mic.fill',
  timer: 'timer',
  clock: 'clock.fill',
  download: 'arrow.down.circle.fill',
  upload: 'arrow.up.circle.fill',
  check: 'checkmark.circle.fill',
  close: 'xmark.circle.fill',
  warning: 'exclamationmark.triangle.fill',
  bell: 'bell.fill',
  car: 'car.fill',
  bike: 'bicycle',
  run: 'figure.run',
  location: 'location.fill',
  bolt: 'bolt.fill',
  battery: 'battery.75',
  heart: 'heart.fill',
  star: 'star.fill',
  bag: 'bag.fill',
  gift: 'gift.fill',
  flame: 'flame.fill',
  sport: 'sportscourt.fill',
} as const;

export type BuiltinIcon = keyof typeof BUILTIN_ICONS;
