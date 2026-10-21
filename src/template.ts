import type { ReactNode } from 'react';

import { toArgb } from './color';
import type { ColorValue } from './primitives';
import { SCHEMA_VERSION, type WireNode, type WirePayload } from './schema';
import { serialize } from './serialize';

export type Region<D> = (data: D) => ReactNode;

export interface TemplateStyle {
  /** lock screen / notification background */
  background?: ColorValue;
  /** Dynamic Island keyline tint (thin outline shown in dark mode) */
  keyline?: ColorValue;
  /** default color for Text, Timer, Icon and Progress */
  textColor?: ColorValue;
}

/**
 * One description, every surface:
 *
 *  surface                    | iOS                       | Android                       | in-app island
 *  ---------------------------|---------------------------|-------------------------------|--------------
 *  compact.leading / trailing | Dynamic Island (compact)  | floating island (compact)     | compact pill
 *  expanded.*                 | Dynamic Island (long-press)| floating island (tap)        | tap to expand
 *  minimal                    | 2+ activities             | detached bubble               | detached bubble
 *  lockScreen                 | lock screen / banner      | expanded notification         | —
 *  notification               | —                         | collapsed notification        | —
 */
export interface LiveActivityTemplate<D> {
  /** unique template name */
  name: string;
  compact?: { leading?: Region<D>; trailing?: Region<D> };
  expanded?: { leading?: Region<D>; trailing?: Region<D>; center?: Region<D>; bottom?: Region<D> };
  minimal?: Region<D>;
  lockScreen?: Region<D>;
  /** Android collapsed notification row. Defaults to compact.leading + compact.trailing */
  notification?: Region<D>;
  style?: TemplateStyle | ((data: D) => TemplateStyle);
  /** deep link opened when the user taps the activity */
  url?: string | ((data: D) => string | undefined);
}

const region = <D>(fn: Region<D> | undefined, data: D): WireNode | undefined => (fn ? serialize(fn(data)) : undefined);

function prune<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/** Render a template with data into the wire payload consumed by every native renderer. */
export function renderTemplate<D>(template: LiveActivityTemplate<D>, data: D): WirePayload {
  const style = typeof template.style === 'function' ? template.style(data) : template.style;
  const url = typeof template.url === 'function' ? template.url(data) : template.url;

  const payload: WirePayload = { v: SCHEMA_VERSION };
  const ls = region(template.lockScreen, data);
  const ex = prune({
    l: region(template.expanded?.leading, data),
    t: region(template.expanded?.trailing, data),
    c: region(template.expanded?.center, data),
    b: region(template.expanded?.bottom, data),
  });
  const cp = prune({ l: region(template.compact?.leading, data), t: region(template.compact?.trailing, data) });
  const mn = region(template.minimal, data);
  const nc = region(template.notification, data);
  const st = style
    ? prune({
        bg: style.background !== undefined ? toArgb(style.background) : undefined,
        kl: style.keyline !== undefined ? toArgb(style.keyline) : undefined,
        fc: style.textColor !== undefined ? toArgb(style.textColor) : undefined,
      })
    : undefined;

  if (ls) payload.ls = ls;
  if (ex) payload.ex = ex;
  if (cp) payload.cp = cp;
  if (mn) payload.mn = mn;
  if (nc) payload.nc = nc;
  if (st) payload.st = st;
  if (url) payload.url = url;
  return payload;
}

/** ActivityKit rejects ContentState larger than 4 KB. */
export const IOS_PAYLOAD_LIMIT = 4096;

export function encodePayload(payload: WirePayload): string {
  return JSON.stringify(payload);
}

export function byteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
