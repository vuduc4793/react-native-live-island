import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Context, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { ensureNativeSync } from './activity';
import { argbToCss } from './color';
import type { WireNode, WirePayload } from './schema';
import { islandStore, type IslandEntry } from './store';
import { WireTextColorProvider, WireView } from './WireView';

// --- Geometry ----------------------------------------------------------------------------------

export interface IslandGeometry {
  /** distance from the top of the screen to the island */
  top: number;
  /** compact / idle height */
  height: number;
  /** idle width (hardware island width on iPhone 14 Pro and newer) */
  idleWidth: number;
  /** space kept free between compact leading and trailing (the camera) */
  centerGap: number;
  /** device has a hardware Dynamic Island: the idle pill is drawn over it */
  hardwareIsland: boolean;
}

type Insets = { top: number };

// react-native-safe-area-context is optional; fall back to its initial metrics or a guess.
const safeArea: { SafeAreaInsetsContext?: Context<Insets | null>; initialWindowMetrics?: { insets: Insets } | null } = (() => {
  try {
    return require('react-native-safe-area-context');
  } catch {
    return {};
  }
})();
const NoInsets = createContext<Insets | null>(null);

function useTopInset(): number {
  const live = useContext(safeArea.SafeAreaInsetsContext ?? NoInsets);
  return live?.top ?? safeArea.initialWindowMetrics?.insets.top ?? (Platform.OS === 'ios' ? 47 : 24);
}

export function useIslandGeometry(overrides?: Partial<IslandGeometry>): IslandGeometry {
  const topInset = useTopInset();
  const { width, height } = useWindowDimensions();
  const portrait = height > width;

  return useMemo(() => {
    let g: IslandGeometry;
    if (Platform.OS === 'ios' && portrait && topInset >= 51) {
      // iPhone 14 Pro and newer: 126×37pt hardware island, its top edge sits ~48pt above the safe area.
      g = { top: Math.max(11, topInset - 48), height: 37, idleWidth: 126, centerGap: 126, hardwareIsland: true };
    } else if (Platform.OS === 'android' && topInset >= 20) {
      // Edge-to-edge Android: wrap the (usually centered) punch-hole camera inside the status bar.
      const h = Math.min(36, Math.max(26, topInset - 6));
      g = { top: Math.max(3, (topInset - h) / 2), height: h, idleWidth: h, centerGap: 30, hardwareIsland: false };
    } else {
      g = { top: topInset + 4, height: 34, idleWidth: 34, centerGap: 8, hardwareIsland: false };
    }
    return { ...g, ...overrides };
  }, [topInset, portrait, overrides]);
}

// --- Theme -------------------------------------------------------------------------------------

export interface IslandTheme {
  backgroundColor: string;
  /** default text/icon color when the template doesn't set one */
  textColor: string;
  /** horizontal padding of the compact pill */
  compactPadding: number;
  /** distance between the expanded island and the screen edges */
  expandedMargin: number;
  expandedRadius: number;
  expandedPadding: number;
  expandedMinHeight: number;
  /** gap between the island and the detached minimal bubble */
  minimalGap: number;
  /** dims the app behind the expanded island; null = no backdrop dimming */
  backdropColor: string | null;
  spring: { damping: number; stiffness: number; mass: number };
  shadow?: ViewStyle;
  /**
   * With `statusBar="keep"`, iOS and Android route touches inside the status bar to the system,
   * so a compact island drawn there can't be tapped. An invisible strip of this height just below
   * the status bar stands in for it. 0 disables it.
   */
  touchStripHeight: number;
}

export const defaultIslandTheme: IslandTheme = {
  backgroundColor: '#000',
  textColor: '#fff',
  compactPadding: 10,
  expandedMargin: 10,
  expandedRadius: 44,
  expandedPadding: 18,
  expandedMinHeight: 84,
  minimalGap: 8,
  backdropColor: 'rgba(0,0,0,0.12)',
  spring: { damping: 17, stiffness: 190, mass: 0.9 },
  touchStripHeight: 24,
};

// --- Island ------------------------------------------------------------------------------------

export interface DynamicIslandViewProps {
  theme?: Partial<IslandTheme>;
  geometry?: Partial<IslandGeometry>;
  /**
   * 'auto'  — skip activities Android already shows in its native floating island
   * 'always' — render every activity in-app
   */
  visibility?: 'auto' | 'always';
  /** called on tap; return true to prevent the default expand/collapse */
  onPress?: (entry: IslandEntry, expanded: boolean) => boolean | void;
  /** custom ordering / filtering of the activities shown */
  filter?: (entries: readonly IslandEntry[]) => readonly IslandEntry[];
  /**
   * The system draws the status bar (clock, signal, battery) on top of the app, so it would paint
   * over an island placed inside it — and it swallows touches there. 'hide' (default) hides the
   * status bar while the island shows an activity; 'keep' leaves it alone.
   */
  statusBar?: 'hide' | 'keep';
}

type Mode = 'idle' | 'compact' | 'expanded';

function Region({ node, style }: { node?: WireNode; style?: ViewStyle }) {
  if (!node) return null;
  return (
    <View style={style}>
      <WireView node={node} />
    </View>
  );
}

/** The in-app island. Mounted for you by <DynamicIslandProvider />. */
export function DynamicIslandView({
  theme: themeOverride,
  geometry: geometryOverride,
  visibility = 'auto',
  onPress,
  filter,
  statusBar = 'hide',
}: DynamicIslandViewProps) {
  const theme = useMemo(() => ({ ...defaultIslandTheme, ...themeOverride }), [themeOverride]);
  const g = useIslandGeometry(geometryOverride);
  const statusBarBottom = useTopInset();
  const { width: screenWidth } = useWindowDimensions();

  useEffect(ensureNativeSync, []);
  const all = useSyncExternalStore(islandStore.subscribe, islandStore.getSnapshot, islandStore.getSnapshot);
  const entries = useMemo(() => {
    const visible = visibility === 'always' ? all : all.filter((e) => !e.nativeOverlay);
    return filter ? filter(visible) : visible;
  }, [all, visibility, filter]);

  const main = entries[0];
  const secondary = entries[1];
  const expandedId = useSyncExternalStore(islandStore.subscribe, islandStore.getExpanded, islandStore.getExpanded);
  const setExpandedId = islandStore.setExpanded;
  const hasExpanded = (p?: WirePayload) => !!p?.ex;
  const mode: Mode = !main ? 'idle' : expandedId === main.id && hasExpanded(main.payload) ? 'expanded' : 'compact';

  useEffect(() => {
    if (expandedId && !entries.some((e) => e.id === expandedId)) setExpandedId(null);
  }, [entries, expandedId, setExpandedId]);

  // Measured content sizes drive the target size, so templates never need hard-coded dimensions.
  const [compactSize, setCompactSize] = useState({ l: 0, t: 0 });
  const [expandedHeight, setExpandedHeight] = useState(0);
  const expandedWidth = screenWidth - theme.expandedMargin * 2;

  const target = useMemo(() => {
    if (mode === 'expanded') {
      return { w: expandedWidth, h: Math.max(theme.expandedMinHeight, expandedHeight), r: theme.expandedRadius, o: 1 };
    }
    if (mode === 'compact') {
      // Symmetric around the camera: both sides take the wider slot so the gap stays centered on it.
      const content = theme.compactPadding * 2 + Math.max(compactSize.l, compactSize.t) * 2 + g.centerGap;
      return { w: Math.max(g.idleWidth, g.height, content), h: g.height, r: g.height / 2, o: 1 };
    }
    return { w: g.idleWidth, h: g.height, r: g.height / 2, o: g.hardwareIsland ? 1 : 0 };
  }, [mode, expandedWidth, expandedHeight, compactSize, g, theme]);

  const anim = useRef({
    w: new Animated.Value(target.w),
    h: new Animated.Value(target.h),
    r: new Animated.Value(target.r),
    o: new Animated.Value(target.o),
    content: new Animated.Value(1),
    bubble: new Animated.Value(0),
  }).current;

  useEffect(() => {
    const spring = (value: Animated.Value, toValue: number) =>
      Animated.spring(value, { toValue, useNativeDriver: false, ...theme.spring });
    Animated.parallel([
      spring(anim.w, target.w),
      spring(anim.h, target.h),
      spring(anim.r, target.r),
      Animated.timing(anim.o, { toValue: target.o, duration: 180, useNativeDriver: false }),
    ]).start();
  }, [target, anim, theme.spring]);

  // Fade the new content in while the shape morphs.
  const contentKey = `${mode}:${main?.id ?? ''}`;
  useEffect(() => {
    anim.content.setValue(0);
    Animated.timing(anim.content, { toValue: 1, duration: 220, delay: 70, useNativeDriver: false }).start();
  }, [contentKey, anim]);

  const overlapsStatusBar = g.top < statusBarBottom;
  const hideStatusBar = statusBar === 'hide' && overlapsStatusBar && mode !== 'idle';
  useEffect(() => {
    if (!hideStatusBar) return;
    StatusBar.setHidden(true, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, [hideStatusBar]);

  const showBubble = !!secondary && mode !== 'expanded';
  useEffect(() => {
    Animated.spring(anim.bubble, { toValue: showBubble ? 1 : 0, useNativeDriver: false, ...theme.spring }).start();
  }, [showBubble, anim, theme.spring]);

  const toggle = (entry: IslandEntry) => {
    const expanded = expandedId === entry.id;
    if (onPress?.(entry, expanded)) return;
    if (!hasExpanded(entry.payload)) return;
    setExpandedId(expanded ? null : entry.id);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, s) => Math.abs(s.dy) > 8 && Math.abs(s.dy) > Math.abs(s.dx),
        onPanResponderRelease: (_e, s) => {
          if (s.dy < -12) setExpandedId(null);
          else if (s.dy > 12 && main && hasExpanded(main.payload)) setExpandedId(main.id);
        },
      }),
    [main, setExpandedId],
  );

  const textColor = main?.payload.st?.fc !== undefined ? argbToCss(main.payload.st.fc) : theme.textColor;
  const onCompactLayout = (key: 'l' | 't') => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    setCompactSize((s) => (s[key] === w ? s : { ...s, [key]: w }));
  };
  const cameraClearance = g.hardwareIsland ? g.height - theme.expandedPadding + 4 : 0;
  const keyline = main?.payload.st?.kl;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {mode === 'expanded' ? (
        <Pressable
          accessibilityLabel="Collapse island"
          style={[StyleSheet.absoluteFill, theme.backdropColor ? { backgroundColor: theme.backdropColor } : null]}
          onPress={() => setExpandedId(null)}
        />
      ) : null}

      <View pointerEvents="box-none" style={[styles.row, { top: g.top }]}>
        <Animated.View
          {...pan.panHandlers}
          style={[
            styles.island,
            {
              width: anim.w,
              height: anim.h,
              borderRadius: anim.r,
              opacity: anim.o,
              backgroundColor: theme.backgroundColor,
            },
            keyline !== undefined && mode === 'expanded' ? { borderWidth: StyleSheet.hairlineWidth, borderColor: argbToCss(keyline) } : null,
            theme.shadow,
          ]}
        >
          <Pressable
            disabled={!main}
            accessibilityRole="button"
            accessibilityLabel={main ? `${main.name} activity` : undefined}
            style={StyleSheet.absoluteFill}
            onPress={() => main && toggle(main)}
            onLongPress={() => main && hasExpanded(main.payload) && setExpandedId(main.id)}
          >
            <WireTextColorProvider value={textColor}>
              {main && mode === 'compact' ? (
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim.content }]}>
                  <View style={[styles.compactSlot, { left: theme.compactPadding }]} onLayout={onCompactLayout('l')}>
                    {main.payload.cp?.l ? <WireView node={main.payload.cp.l} /> : null}
                  </View>
                  <View style={[styles.compactSlot, { right: theme.compactPadding }]} onLayout={onCompactLayout('t')}>
                    {main.payload.cp?.t ? <WireView node={main.payload.cp.t} /> : null}
                  </View>
                </Animated.View>
              ) : null}

              {main && mode === 'expanded' ? (
                <Animated.View
                  style={[styles.expanded, { width: expandedWidth, padding: theme.expandedPadding, opacity: anim.content }]}
                  onLayout={(e) => setExpandedHeight(Math.ceil(e.nativeEvent.layout.height))}
                >
                  <View style={styles.expandedTop}>
                    <Region node={main.payload.ex?.l} />
                    <Region node={main.payload.ex?.c} style={{ flex: 1, alignItems: 'center', paddingTop: main.payload.ex?.c ? cameraClearance : 0 }} />
                    {!main.payload.ex?.c ? <View style={{ flex: 1 }} /> : null}
                    <Region node={main.payload.ex?.t} />
                  </View>
                  <Region node={main.payload.ex?.b} style={{ marginTop: 10 }} />
                </Animated.View>
              ) : null}
            </WireTextColorProvider>
          </Pressable>
        </Animated.View>

        {main && mode === 'compact' && theme.touchStripHeight > 0 && overlapsStatusBar && !hideStatusBar ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${main.name} activity`}
            onPress={() => toggle(main)}
            style={{
              position: 'absolute',
              top: statusBarBottom - g.top,
              height: theme.touchStripHeight,
              left: (screenWidth - target.w) / 2,
              width: target.w,
            }}
          />
        ) : null}
        {secondary ? (
          <Animated.View
            style={[
              styles.bubble,
              {
                width: g.height,
                height: g.height,
                borderRadius: g.height / 2,
                backgroundColor: theme.backgroundColor,
                left: Animated.add(Animated.multiply(anim.w, 0.5), screenWidth / 2 + theme.minimalGap),
                opacity: anim.bubble,
                transform: [{ scale: anim.bubble.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
              },
            ]}
          >
            <Pressable
              style={styles.bubblePress}
              onPress={() => {
                // Promote the secondary activity to the main slot.
                islandStore.patch(secondary.id, { priority: main!.priority, startedAt: Date.now() });
              }}
            >
              <WireTextColorProvider value={secondary.payload.st?.fc !== undefined ? argbToCss(secondary.payload.st.fc) : theme.textColor}>
                {(secondary.payload.mn ?? secondary.payload.cp?.l) ? <WireView node={(secondary.payload.mn ?? secondary.payload.cp?.l)!} /> : null}
              </WireTextColorProvider>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  island: { overflow: 'hidden' },
  compactSlot: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  expanded: { position: 'absolute', top: 0, left: 0 },
  expandedTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bubble: { position: 'absolute', top: 0 },
  bubblePress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

// --- Provider ----------------------------------------------------------------------------------

export interface DynamicIslandProviderProps extends DynamicIslandViewProps {
  children?: ReactNode;
  /** set false to render <DynamicIslandView /> yourself somewhere else */
  island?: boolean;
}

/** Wrap your app once. Renders the in-app island above everything. */
export function DynamicIslandProvider({ children, island = true, ...props }: DynamicIslandProviderProps) {
  return (
    <View style={{ flex: 1 }}>
      {children}
      {island ? <DynamicIslandView {...props} /> : null}
    </View>
  );
}
