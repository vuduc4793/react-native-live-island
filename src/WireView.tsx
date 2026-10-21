import { createContext, useContext, useEffect, useState, type ReactElement } from 'react';
import { Image, Platform, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { argbToCss, toArgb } from './color';
import { getNativeModule } from './native';
import type { WireAlign, WireNode, WireWeight } from './schema';

/**
 * React Native renderer for the wire format. Used by the in-app island and <LiveActivityPreview />,
 * so what you see in the app matches the system Live Activity.
 */

const TextColor = createContext('#fff');
export const WireTextColorProvider = TextColor.Provider;

type Axis = 'row' | 'column' | 'none';

const ALIGN: Record<WireAlign, ViewStyle['alignItems']> = { s: 'flex-start', c: 'center', e: 'flex-end' };
const TEXT_ALIGN: Record<WireAlign, TextStyle['textAlign']> = { s: 'left', c: 'center', e: 'right' };
const WEIGHT: Record<WireWeight, TextStyle['fontWeight']> = {
  ul: '100',
  l: '300',
  r: '400',
  m: '500',
  sb: '600',
  b: '700',
  h: '800',
};

/** Shown when the native icon view isn't available (Expo Go / web). */
const EMOJI: Record<string, string> = {
  'play.fill': '▶',
  'pause.fill': '⏸',
  'stop.fill': '⏹',
  'forward.fill': '⏩',
  'backward.fill': '⏪',
  'music.note': '♪',
  'phone.fill': '📞',
  'phone.down.fill': '📵',
  'mic.fill': '🎙',
  timer: '⏱',
  'clock.fill': '🕒',
  'arrow.down.circle.fill': '⬇',
  'arrow.up.circle.fill': '⬆',
  'checkmark.circle.fill': '✓',
  'xmark.circle.fill': '✕',
  'exclamationmark.triangle.fill': '⚠',
  'bell.fill': '🔔',
  'car.fill': '🚗',
  bicycle: '🚲',
  'figure.run': '🏃',
  'location.fill': '📍',
  'bolt.fill': '⚡',
  'battery.75': '🔋',
  'heart.fill': '♥',
  'star.fill': '★',
  'bag.fill': '🛍',
  'gift.fill': '🎁',
  'flame.fill': '🔥',
  'sportscourt.fill': '🏟',
};

const iconCache = new Map<string, string | null>();

/** PNG data URI of an icon rendered by the native module (SF Symbol / Android drawable), cached per look. */
function nativeIcon(name: string, android: string | undefined, size: number, color: number): string | null {
  const module = getNativeModule();
  if (!module) return null;
  const key = `${name}|${android ?? ''}|${size}|${color}`;
  let uri = iconCache.get(key);
  if (uri === undefined) {
    try {
      uri = module.iconImage(name, android ?? null, size, color);
    } catch {
      uri = null;
    }
    iconCache.set(key, uri);
  }
  return uri;
}

/** Re-render every `interval` ms while mounted (timers, time-based progress). */
function useNow(interval: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval, enabled]);
  return now;
}

/** Same format as SwiftUI's timer text: m:ss or h:mm:ss */
export function formatTimer(totalMs: number): string {
  const total = Math.max(0, Math.floor(totalMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function boxStyle(node: WireNode, axis: Axis): ViewStyle & { overflow?: 'hidden' } {
  const style: Mutable<ViewStyle> & { overflow?: 'hidden' } = {};
  if ('p' in node && node.p) {
    [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft] = node.p;
  }
  if ('bg' in node && node.bg !== undefined) style.backgroundColor = argbToCss(node.bg);
  if ('r' in node && node.r !== undefined) {
    style.borderRadius = node.r;
    style.overflow = 'hidden';
  }
  if ('w' in node && node.w !== undefined) style.width = node.w;
  if ('h' in node && node.h !== undefined) style.height = node.h;
  if ('fx' in node && node.fx) {
    if (axis === 'row') {
      style.flexGrow = 1;
      style.flexShrink = 1;
    } else style.alignSelf = 'stretch';
  }
  if ('o' in node && node.o !== undefined) style.opacity = node.o;
  return style;
}

function textStyle(node: Extract<WireNode, { t: 'tx' | 'tm' }>, fallbackColor: string): TextStyle {
  return {
    fontSize: node.fs ?? 15,
    fontWeight: node.fw ? WEIGHT[node.fw] : '400',
    color: node.fc !== undefined ? argbToCss(node.fc) : fallbackColor,
    textAlign: node.ta ? TEXT_ALIGN[node.ta] : undefined,
    fontVariant: node.t === 'tm' || ('mo' in node && node.mo) ? ['tabular-nums'] : undefined,
    fontFamily: node.rd && Platform.OS === 'ios' ? 'ui-rounded' : undefined,
  };
}

function TimerText({ node }: { node: Extract<WireNode, { t: 'tm' }> }) {
  const color = useContext(TextColor);
  const now = useNow(250, true);
  const value = node.e !== undefined ? node.e - now : now - (node.f ?? now);
  return (
    <Text style={[textStyle(node, color), boxStyle(node, 'none')]} numberOfLines={1}>
      {formatTimer(node.e !== undefined ? value + 999 : value)}
    </Text>
  );
}

function ProgressView({ node, axis }: { node: Extract<WireNode, { t: 'pg' }>; axis: Axis }) {
  const color = useContext(TextColor);
  const timed = node.f !== undefined && node.e !== undefined && node.e > node.f;
  const now = useNow(500, timed);
  const value = timed ? Math.min(1, Math.max(0, (now - node.f!) / (node.e! - node.f!))) : (node.v ?? 0);
  const tint = node.fc !== undefined ? argbToCss(node.fc) : color;
  const track = node.tc !== undefined ? argbToCss(node.tc) : 'rgba(255,255,255,0.2)';
  const thickness = node.lw ?? (node.k === 'ring' ? 3 : 4);

  if (node.k === 'ring') {
    const size = node.s ?? 20;
    return (
      <View style={[{ width: size, height: size }, boxStyle(node, axis)]}>
        <Ring size={size} thickness={thickness} value={value} tint={tint} track={track} />
      </View>
    );
  }
  return (
    <View
      style={[
        { height: thickness, borderRadius: thickness / 2, backgroundColor: track, overflow: 'hidden', alignSelf: 'stretch' },
        axis === 'row' ? { flexGrow: 1 } : null,
        boxStyle(node, axis),
      ]}
    >
      <View style={{ width: `${value * 100}%`, height: '100%', backgroundColor: tint, borderRadius: thickness / 2 }} />
    </View>
  );
}

/** Progress ring drawn with two rotating half-discs (no SVG dependency). */
function Ring({ size, thickness, value, tint, track }: { size: number; thickness: number; value: number; tint: string; track: string }) {
  const half = size / 2;
  const deg = value * 360;
  const halfStyle = (rotate: number, color: string): ViewStyle => ({
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: thickness,
    borderColor: 'transparent',
    borderTopColor: color,
    borderRightColor: color,
    transform: [{ rotate: `${rotate}deg` }],
  });
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: half, borderWidth: thickness, borderColor: track }} />
      {/* right half: 0..180° */}
      <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
        <View style={[halfStyle(-135 + Math.min(deg, 180), tint), { left: -half }]} />
      </View>
      {/* left half: 180..360° */}
      {deg > 180 ? (
        <View style={{ position: 'absolute', left: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={halfStyle(45 + (deg - 180), tint)} />
        </View>
      ) : null}
    </View>
  );
}

function IconView({ node, axis }: { node: Extract<WireNode, { t: 'ic' }>; axis: Axis }) {
  const color = useContext(TextColor);
  const size = node.s ?? 16;
  const uri = nativeIcon(node.n, node.an, size, node.fc ?? toArgb(color));
  if (uri) {
    return (
      <Image
        source={{ uri, width: size * 1.25, height: size * 1.25 }}
        resizeMode="contain"
        style={{ width: size * 1.25, height: size * 1.25, ...boxStyle(node, axis) }}
      />
    );
  }
  return (
    <Text style={[{ fontSize: size, color: node.fc !== undefined ? argbToCss(node.fc) : color }, boxStyle(node, axis)]}>
      {EMOJI[node.n] ?? '•'}
    </Text>
  );
}

export function WireView({ node, axis = 'none' }: { node: WireNode; axis?: Axis }): ReactElement | null {
  const color = useContext(TextColor);

  switch (node.t) {
    case 'v':
    case 'h': {
      const row = node.t === 'h';
      return (
        <View
          style={[
            { flexDirection: row ? 'row' : 'column', alignItems: ALIGN[node.a ?? 'c'], gap: node.sp ?? 6 },
            boxStyle(node, axis),
          ]}
        >
          {node.c.map((child, i) => (
            <WireView key={i} node={child} axis={row ? 'row' : 'column'} />
          ))}
        </View>
      );
    }
    case 'z':
      return (
        <View style={[{ alignItems: ALIGN[node.a ?? 'c'], justifyContent: 'center' }, boxStyle(node, axis)]}>
          {node.c.map((child, i) =>
            i === 0 ? (
              <WireView key={i} node={child} />
            ) : (
              <View
                key={i}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: ALIGN[node.a ?? 'c'], justifyContent: 'center' }}
              >
                <WireView node={child} />
              </View>
            ),
          )}
        </View>
      );
    case 'tx':
      return (
        <Text style={[textStyle(node, color), boxStyle(node, axis)]} numberOfLines={node.ln}>
          {node.v}
        </Text>
      );
    case 'tm':
      return <TimerText node={node} />;
    case 'ic':
      return <IconView node={node} axis={axis} />;
    case 'im':
      return (
        <Image
          source={{ uri: node.n }}
          resizeMode={node.cm === 'fit' ? 'contain' : 'cover'}
          style={[{ width: node.w ?? 24, height: node.h ?? 24 }, boxStyle(node, axis)]}
        />
      );
    case 'sp':
      return (
        <View
          style={
            axis === 'row'
              ? { flexGrow: 1, minWidth: node.s ?? 0 }
              : axis === 'column'
                ? { flexGrow: 1, minHeight: node.s ?? 0 }
                : null
          }
        />
      );
    case 'pg':
      return <ProgressView node={node} axis={axis} />;
    default:
      return null;
  }
}
