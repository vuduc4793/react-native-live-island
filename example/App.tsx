import { useEffect, useRef, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  areActivitiesEnabled,
  DynamicIslandProvider,
  endAllActivities,
  getAndroidNotificationHealth,
  getNativeActivities,
  hasOverlayPermission,
  LiveActivityPreview,
  requestNotificationPermission,
  requestOverlayPermission,
  type LiveActivity,
} from 'react-native-live-island';

import { Delivery, GoalRun, NowPlaying, Run, Upload, type DeliveryData, type MusicData, type RunData, type UploadData } from './src/activities';

const minutes = (n: number) => new Date(Date.now() + n * 60_000);
const DELIVERY_STEPS = ['Đã nhận đơn', 'Đang chuẩn bị món', 'Tài xế đang đến', 'Đã giao'];

export default function App() {
  return (
    <SafeAreaProvider>
      <DynamicIslandProvider>
        <Demo />
      </DynamicIslandProvider>
    </SafeAreaProvider>
  );
}

function Demo() {
  const delivery = useRef<LiveActivity<DeliveryData>>(undefined);
  const music = useRef<LiveActivity<MusicData>>(undefined);
  const upload = useRef<LiveActivity<UploadData>>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 6));

  const startDelivery = async () => {
    await requestNotificationPermission();
    delivery.current = await Delivery.start({ eta: minutes(12), driver: 'Minh', status: DELIVERY_STEPS[1]!, step: 1 });
    say(`delivery started (${delivery.current.id.slice(0, 8)})`);
  };
  const advanceDelivery = async () => {
    const a = delivery.current;
    if (!a?.isActive) return startDelivery();
    const step = Math.min(a.data.step + 1, 4);
    if (step === 4) {
      await a.end({ data: { ...a.data, step, status: DELIVERY_STEPS[3]!, eta: new Date() }, dismiss: 'default' });
      say('delivery ended');
      return;
    }
    await a.patch({ step, status: DELIVERY_STEPS[step]!, eta: minutes(12 - step * 4) }, { alert: { title: 'Cập nhật đơn hàng', body: DELIVERY_STEPS[step]! } });
    say(`delivery → ${DELIVERY_STEPS[step]}`);
  };

  const toggleMusic = async () => {
    if (!music.current?.isActive) {
      music.current = await NowPlaying.start({ title: 'Nơi này có anh', artist: 'Sơn Tùng M-TP', playing: true, startedAt: new Date(), endsAt: minutes(4.3) });
      say('music started');
    } else {
      await music.current.patch({ playing: !music.current.data.playing });
      say(music.current.data.playing ? 'music playing' : 'music paused');
    }
  };

  // Simulated run: +~35 m every 3 s. Android hosts the notification in a 'location' foreground service,
  // as a run-tracking screen would (the app must hold a location permission first).
  const run = useRef<LiveActivity<RunData>>(undefined);
  const runClock = useRef({ activeMs: 0, resumedAt: 0, timer: undefined as ReturnType<typeof setInterval> | undefined });
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const activeMs = () => runClock.current.activeMs + (runClock.current.resumedAt ? Date.now() - runClock.current.resumedAt : 0);
  const pace = (km: number) => {
    if (km < 0.01) return "--'--\"";
    const secPerKm = activeMs() / 1000 / km;
    return `${Math.floor(secPerKm / 60)}'${String(Math.round(secPerKm % 60)).padStart(2, '0')}"`;
  };
  const toggleRun = async () => {
    const a = run.current;
    const clock = runClock.current;
    if (!a?.isActive) {
      await requestNotificationPermission();
      if (Platform.OS === 'android') await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      clock.activeMs = 0;
      clock.resumedAt = Date.now();
      run.current = await Run.start(
        { startAt: Date.now(), distanceKm: 0, pace: pace(0), heartRate: 128 },
        { priority: 1, androidForegroundService: 'location' },
      );
      clock.timer = setInterval(() => {
        const r = run.current;
        if (!r?.isActive || r.data.pausedText) return;
        const km = r.data.distanceKm + 0.035;
        r.patch({ distanceKm: km, pace: pace(km), heartRate: 125 + Math.round(Math.random() * 20) });
      }, 3000);
      say('run started');
    } else if (!a.data.pausedText) {
      clock.activeMs = activeMs();
      clock.resumedAt = 0;
      await a.patch({ pausedText: fmt(clock.activeMs) });
      say('run paused');
    } else {
      clock.resumedAt = Date.now();
      await a.patch({ pausedText: undefined, startAt: Date.now() - clock.activeMs });
      say('run resumed');
    }
  };
  const endRun = async () => {
    if (runClock.current.timer) clearInterval(runClock.current.timer);
    await run.current?.end({ dismiss: 'immediate' });
    say('run ended');
  };

  // Same flow as a run-tracking screen: foreground service starts in the idle phase when the map opens.
  const startGoalRun = async (style: 'auto' | 'standard' = 'auto') => {
    await requestNotificationPermission();
    if (Platform.OS === 'android') await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    await GoalRun.start(
      { phase: 'idle', startAt: 0, distanceKm: 0, pace: '--', goalKm: 5 },
      { inApp: false, androidForegroundService: 'location', androidNotificationStyle: style },
    );
    say(`goal run (idle, foreground service, ${style}) started`);
  };

  const runUpload = async () => {
    upload.current = await Upload.start({ file: 'bao-cao-q3.pdf', progress: 0 });
    say('upload started');
    for (let i = 1; i <= 10; i++) {
      await new Promise<void>((r) => setTimeout(r, 700));
      if (!upload.current.isActive) return;
      await upload.current.patch({ progress: i / 10 });
    }
    await upload.current.end({ dismiss: 'immediate' });
    say('upload finished');
  };

  // Scriptable demo: `xcrun simctl openurl booted liveisland://demo/delivery` (or `adb shell am start -d …`).
  const actions: Record<string, () => unknown> = { delivery: advanceDelivery, music: toggleMusic, run: toggleRun, runend: endRun, goalrun: () => startGoalRun('auto'), goalstd: () => startGoalRun('standard'), upload: runUpload, end: endAllActivities };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const run = (url?: string | null) => {
      const m = url && /demo\/(\w+)/.exec(url);
      if (m) actionsRef.current[m[1]!]?.();
    };
    Linking.getInitialURL().then(run);
    const sub = Linking.addEventListener('url', (e) => run(e.url));
    return () => sub.remove();
  }, []);

  const enabled = areActivitiesEnabled();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Live Island</Text>
        <Text style={styles.subtitle}>
          Native: {enabled ? `enabled (${getNativeActivities().filter((a) => a.state === 'active').length} active)` : 'unavailable (in-app island only)'} · {Platform.OS}
          {Platform.OS === 'android' ? ` · overlay ${hasOverlayPermission() ? 'granted' : 'not granted'}` : ''}
          {Platform.OS === 'android' ? ` · custom views ${getAndroidNotificationHealth().customViews}` : ''}
        </Text>

        <View style={styles.grid}>
          <Button label="🛵 Giao hàng" hint="start / next step" onPress={advanceDelivery} />
          <Button label="🎵 Nhạc" hint="start / play-pause" onPress={toggleMusic} />
          <Button label="🏃 Chạy bộ" hint="start / pause / resume" onPress={toggleRun} />
          <Button label="🏁 Kết thúc chạy" hint="end run" onPress={endRun} />
          <Button label="⬆️ Upload" hint="progress 0 → 100%" onPress={runUpload} />
        </View>
        <Button
          label="End all"
          hint="in-app + native"
          onPress={async () => {
            try {
              await endAllActivities();
              say(`all ended (${getNativeActivities().length} left)`);
            } catch (e) {
              say(`end failed: ${(e as Error).message}`);
            }
          }}
        />
        {Platform.OS === 'android' ? (
          <Button label="Allow floating island" hint="Display over other apps" onPress={requestOverlayPermission} />
        ) : null}

        {log.length ? <Text style={styles.log}>{log.join('\n')}</Text> : null}

        <Text style={styles.section}>Preview (no activity needed)</Text>
        <LiveActivityPreview template={Delivery.template} data={{ eta: minutes(8), driver: 'Minh', status: 'Tài xế đang đến', step: 2 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Button({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Text style={styles.buttonLabel}>{label}</Text>
      <Text style={styles.buttonHint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 20, paddingTop: 70, gap: 12 },
  title: { fontSize: 34, fontWeight: '800' },
  subtitle: { color: '#6e6e73', marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { flexGrow: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 2 },
  buttonLabel: { fontSize: 17, fontWeight: '600' },
  buttonHint: { fontSize: 12, color: '#8e8e93' },
  log: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, color: '#3a3a3c' },
  section: { marginTop: 12, fontSize: 20, fontWeight: '700' },
});
