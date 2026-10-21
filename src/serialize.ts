import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';

import { toArgb } from './color';
import type { Align, BoxProps, FontWeight, Padding, PrimitiveKind, TimeValue } from './primitives';
import { BUILTIN_ICONS, type WireAlign, type WireMods, type WireNode, type WireWeight } from './schema';

const ALIGN: Record<Align, WireAlign> = { start: 's', center: 'c', end: 'e' };
const WEIGHT: Record<FontWeight, WireWeight> = {
  ultralight: 'ul',
  light: 'l',
  regular: 'r',
  medium: 'm',
  semibold: 'sb',
  bold: 'b',
  heavy: 'h',
};

export const DEFAULT_SPACING = 6;
export const DEFAULT_FONT_SIZE = 15;
export const DEFAULT_ICON_SIZE = 16;

const num = (n: number) => Math.round(n * 100) / 100;
const time = (t: TimeValue) => (t instanceof Date ? t.getTime() : t);

export function normalizePadding(p: Padding): [number, number, number, number] {
  if (typeof p === 'number') return [p, p, p, p];
  if (Array.isArray(p)) return p.length === 2 ? [p[0], p[1], p[0], p[1]] : [p[0], p[1], p[2], p[3]];
  const v = p.vertical ?? 0;
  const h = p.horizontal ?? 0;
  return [p.top ?? v, p.right ?? h, p.bottom ?? v, p.left ?? h];
}

function mods(props: BoxProps): WireMods {
  const out: WireMods = {};
  if (props.padding !== undefined) out.p = normalizePadding(props.padding);
  if (props.background !== undefined) out.bg = toArgb(props.background);
  if (props.radius !== undefined) out.r = num(props.radius);
  if (props.width !== undefined) out.w = num(props.width);
  if (props.height !== undefined) out.h = num(props.height);
  if (props.fill) out.fx = 1;
  if (props.opacity !== undefined) out.o = num(props.opacity);
  return out;
}

/** Drop undefined keys so the JSON stays small. */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function textOf(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number' || typeof children === 'bigint') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (isValidElement(children)) {
    if (children.type === Fragment) return textOf((children.props as { children?: ReactNode }).children);
    throw new Error('[dynamic-island] <Text> can only contain strings and numbers.');
  }
  return '';
}

/** Expand fragments, arrays and user components into a flat list of serialized nodes. */
function serializeChildren(children: ReactNode, depth: number): WireNode[] {
  const out: WireNode[] = [];
  const visit = (child: ReactNode) => {
    if (child === null || child === undefined || typeof child === 'boolean' || child === '') return;
    if (Array.isArray(child)) return child.forEach(visit);
    if (isValidElement(child) && child.type === Fragment) {
      return visit((child.props as { children?: ReactNode }).children);
    }
    const node = serializeOne(child, depth);
    if (Array.isArray(node)) out.push(...node);
    else if (node) out.push(node);
  };
  visit(children);
  return out;
}

function serializeOne(child: ReactNode, depth: number): WireNode | WireNode[] | undefined {
  if (depth > 64) throw new Error('[dynamic-island] Template is nested too deeply (recursive component?).');
  if (typeof child === 'string' || typeof child === 'number') return { t: 'tx', v: String(child) };
  if (!isValidElement(child)) return undefined;

  const element = child as ReactElement<Record<string, any>>;
  const type = element.type as unknown;
  const props = element.props;

  if (typeof type === 'function') {
    const kind = (type as { __di?: PrimitiveKind }).__di;
    if (kind) return serializePrimitive(kind, props, depth);
    // A user component that composes primitives: evaluate it as a plain function.
    let rendered: ReactNode;
    try {
      rendered = (type as (p: object) => ReactNode)(props);
    } catch (e) {
      const name = (type as { displayName?: string; name?: string }).displayName ?? (type as { name?: string }).name;
      throw new Error(
        `[dynamic-island] Failed to evaluate <${name ?? 'Anonymous'}> inside a template. ` +
          `Template components must be plain functions without hooks. Cause: ${(e as Error).message}`,
      );
    }
    return serializeChildren(rendered, depth + 1);
  }

  throw new Error(
    `[dynamic-island] Unsupported element <${String(type)}> in template. ` +
      'Use VStack, HStack, ZStack, Text, Icon, Image, Spacer, Progress or Timer.',
  );
}

function serializePrimitive(kind: PrimitiveKind, props: Record<string, any>, depth: number): WireNode {
  switch (kind) {
    case 'v':
    case 'h':
    case 'z': {
      const children = serializeChildren(props.children, depth + 1);
      // SwiftUI semantics: a stack holding something that wants all the width (fill, a linear
      // progress bar, a Spacer in an HStack) wants it too. Making that explicit lets Android and
      // React Native, whose containers hug their content by default, lay out the same way.
      const greedy = children.some(
        (c) => ('fx' in c && c.fx) || (c.t === 'pg' && c.k === 'bar' && c.w === undefined) || (kind === 'h' && c.t === 'sp'),
      );
      return compact({
        t: kind,
        c: children,
        // Defaults are made explicit so SwiftUI, Android and React Native lay out identically.
        sp: kind === 'z' ? undefined : (props.spacing ?? DEFAULT_SPACING),
        a: props.align ? ALIGN[props.align as Align] : undefined,
        ...mods(props),
        ...(greedy && props.width === undefined ? { fx: 1 as const } : null),
      });
    }
    case 'tx':
      return compact({
        t: 'tx',
        v: textOf(props.children),
        fs: props.size ?? DEFAULT_FONT_SIZE,
        fw: props.weight ? WEIGHT[props.weight as FontWeight] : undefined,
        fc: props.color !== undefined ? toArgb(props.color) : undefined,
        ln: props.lines,
        ta: props.align ? ALIGN[props.align as Align] : undefined,
        mo: props.monospacedDigits ? 1 : undefined,
        rd: props.rounded ? 1 : undefined,
        ...mods(props),
      });
    case 'ic':
      return compact({
        t: 'ic',
        n: (BUILTIN_ICONS as Record<string, string>)[props.name] ?? props.name,
        an: props.android,
        s: props.size ?? DEFAULT_ICON_SIZE,
        fc: props.color !== undefined ? toArgb(props.color) : undefined,
        ...mods(props),
      });
    case 'im':
      return compact({ t: 'im', n: props.name, cm: props.fit, ...mods(props) });
    case 'sp':
      return compact({ t: 'sp', s: props.size });
    case 'pg': {
      const timed = props.start !== undefined && props.end !== undefined;
      return compact({
        t: 'pg',
        k: props.variant ?? 'bar',
        v: timed ? undefined : num(Math.max(0, Math.min(1, props.value ?? 0))),
        f: timed ? time(props.start) : undefined,
        e: timed ? time(props.end) : undefined,
        fc: props.color !== undefined ? toArgb(props.color) : undefined,
        tc: props.trackColor !== undefined ? toArgb(props.trackColor) : undefined,
        s: props.variant === 'ring' ? (props.size ?? 20) : undefined,
        lw: props.thickness ?? (props.variant === 'ring' ? 3 : 4),
        ...mods(props),
      });
    }
    case 'tm':
      if (props.to === undefined && props.from === undefined) {
        throw new Error('[dynamic-island] <Timer> needs either `to` (countdown) or `from` (count up).');
      }
      return compact({
        t: 'tm',
        e: props.to !== undefined ? time(props.to) : undefined,
        f: props.from !== undefined ? time(props.from) : undefined,
        fs: props.size ?? DEFAULT_FONT_SIZE,
        fw: props.weight ? WEIGHT[props.weight as FontWeight] : undefined,
        fc: props.color !== undefined ? toArgb(props.color) : undefined,
        ta: props.align ? ALIGN[props.align as Align] : undefined,
        rd: props.rounded ? 1 : undefined,
        ...mods(props),
      });
  }
}

/**
 * Serialize a region (the JSX returned by a template function) into a single wire node.
 * Several top-level nodes are wrapped in a VStack.
 */
export function serialize(node: ReactNode): WireNode | undefined {
  const nodes = serializeChildren(node, 0);
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { t: 'v', c: nodes };
}
