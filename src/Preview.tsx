import { useMemo } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { argbToCss } from './color';
import { renderTemplate, type LiveActivityTemplate } from './template';
import { WireTextColorProvider, WireView } from './WireView';

export interface LiveActivityPreviewProps<D> {
  template: LiveActivityTemplate<D>;
  data: D;
  /** which surfaces to draw */
  surfaces?: ('compact' | 'minimal' | 'expanded' | 'lockScreen')[];
  style?: ViewStyle;
}

/**
 * Static rendering of every surface of a template — handy for designing templates without
 * starting a real activity (works in Expo Go and on web too).
 */
export function LiveActivityPreview<D>({
  template,
  data,
  surfaces = ['compact', 'minimal', 'expanded', 'lockScreen'],
  style,
}: LiveActivityPreviewProps<D>) {
  const payload = useMemo(() => renderTemplate(template, data), [template, data]);
  const textColor = payload.st?.fc !== undefined ? argbToCss(payload.st.fc) : '#fff';

  return (
    <WireTextColorProvider value={textColor}>
      <View style={[styles.root, style]}>
        {surfaces.includes('compact') && payload.cp ? (
          <Labeled label="Compact">
            <View style={styles.compact}>
              {payload.cp.l ? <WireView node={payload.cp.l} /> : null}
              <View style={styles.camera} />
              {payload.cp.t ? <WireView node={payload.cp.t} /> : null}
            </View>
          </Labeled>
        ) : null}
        {surfaces.includes('minimal') && (payload.mn ?? payload.cp?.l) ? (
          <Labeled label="Minimal">
            <View style={styles.minimal}>
              <WireView node={(payload.mn ?? payload.cp?.l)!} />
            </View>
          </Labeled>
        ) : null}
        {surfaces.includes('expanded') && payload.ex ? (
          <Labeled label="Expanded">
            <View style={styles.expanded}>
              <View style={styles.row}>
                {payload.ex.l ? <WireView node={payload.ex.l} /> : null}
                <View style={{ flex: 1, alignItems: 'center' }}>{payload.ex.c ? <WireView node={payload.ex.c} /> : null}</View>
                {payload.ex.t ? <WireView node={payload.ex.t} /> : null}
              </View>
              {payload.ex.b ? <View style={{ marginTop: 10 }}><WireView node={payload.ex.b} /></View> : null}
            </View>
          </Labeled>
        ) : null}
        {surfaces.includes('lockScreen') && payload.ls ? (
          <Labeled label="Lock screen / notification">
            <View style={[styles.lockScreen, { backgroundColor: payload.st?.bg !== undefined ? argbToCss(payload.st.bg) : '#1c1c1e' }]}>
              <WireView node={payload.ls} />
            </View>
          </Labeled>
        ) : null}
      </View>
    </WireTextColorProvider>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  label: { fontSize: 12, fontWeight: '600', color: '#8e8e93', textTransform: 'uppercase' },
  compact: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    height: 37,
    borderRadius: 18.5,
    paddingHorizontal: 10,
    backgroundColor: '#000',
    gap: 8,
  },
  camera: { width: 90 },
  minimal: { alignSelf: 'center', width: 37, height: 37, borderRadius: 18.5, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  expanded: { borderRadius: 44, backgroundColor: '#000', padding: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lockScreen: { borderRadius: 22, padding: 16 },
});
