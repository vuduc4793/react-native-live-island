// Each template is written ONCE and drives: iOS Dynamic Island + lock screen,
// the Android floating island + notification, and the in-app island.
import { defineLiveActivity, HStack, Icon, Progress, Text, Timer, VStack } from 'react-native-live-island';

const GREEN = '#34c759';
const ORANGE = '#ff9f0a';
const GRAY = '#8e8e93';

// --- Food / ride delivery -----------------------------------------------------------------
export type DeliveryData = { eta: Date; driver: string; status: string; step: number };

export const Delivery = defineLiveActivity<DeliveryData>({
  name: 'delivery',
  compact: {
    leading: () => <Icon name="bike" color={GREEN} />,
    trailing: (d) => <Timer to={d.eta} size={14} weight="semibold" color={GREEN} width={54} align="end" />,
  },
  minimal: () => <Icon name="bike" color={GREEN} size={14} />,
  expanded: {
    leading: () => <Icon name="bike" color={GREEN} size={26} padding={[4, 2]} />,
    trailing: (d) => (
      <VStack align="end" spacing={0}>
        <Timer to={d.eta} size={22} weight="bold" color={GREEN} width={76} align="end" />
        <Text size={11} color={GRAY}>còn lại</Text>
      </VStack>
    ),
    center: (d) => (
      <VStack align="start" spacing={1}>
        <Text size={15} weight="semibold" lines={1}>{d.status}</Text>
        <Text size={12} color={GRAY} lines={1}>Tài xế {d.driver}</Text>
      </VStack>
    ),
    // Inset a little so the rounded island corners don't clip the last segment.
    bottom: (d) => <Steps step={d.step} inset={8} />,
  },
  lockScreen: (d) => (
    <VStack align="start" spacing={10}>
      <HStack spacing={10}>
        <Icon name="bike" color={GREEN} size={22} />
        <VStack align="start" spacing={1} fill>
          <Text size={16} weight="semibold">{d.status}</Text>
          <Text size={13} color={GRAY}>Tài xế {d.driver}</Text>
        </VStack>
        <Timer to={d.eta} size={24} weight="bold" color={GREEN} width={84} align="end" />
      </HStack>
      <Steps step={d.step} />
    </VStack>
  ),
  style: { background: '#101012', textColor: '#ffffff', keyline: GREEN },
  url: 'didemo://delivery',
});

// A plain function component made of primitives — reused in two regions above.
function Steps({ step, inset = 0 }: { step: number; inset?: number }) {
  return (
    <HStack spacing={4} padding={[0, inset, inset / 2, inset]}>
      {[0, 1, 2, 3].map((i) => (
        <Progress key={i} value={i < step ? 1 : 0} color={GREEN} trackColor="#ffffff33" thickness={5} fill />
      ))}
    </HStack>
  );
}

// --- Music --------------------------------------------------------------------------------
export type MusicData = { title: string; artist: string; playing: boolean; startedAt: Date; endsAt: Date };

export const NowPlaying = defineLiveActivity<MusicData>({
  name: 'music',
  compact: {
    leading: () => <Icon name="music" color="#ff375f" />,
    trailing: (d) => <Icon name={d.playing ? 'pause' : 'play'} />,
  },
  minimal: () => <Icon name="music" color="#ff375f" size={14} />,
  expanded: {
    leading: () => <Icon name="music" color="#ff375f" size={30} width={52} height={52} background="#2c2c2e" radius={12} />,
    center: (d) => (
      <VStack align="start" spacing={2}>
        <Text weight="semibold" lines={1}>{d.title}</Text>
        <Text size={13} color={GRAY} lines={1}>{d.artist}</Text>
      </VStack>
    ),
    trailing: (d) => <Icon name={d.playing ? 'pause' : 'play'} size={24} padding={8} />,
    bottom: (d) => (
      <HStack spacing={8}>
        <Icon name="backward" size={14} color={GRAY} />
        <Progress start={d.startedAt} end={d.endsAt} color="#fff" fill />
        <Icon name="forward" size={14} color={GRAY} />
      </HStack>
    ),
  },
  lockScreen: (d) => (
    <HStack spacing={12}>
      <Icon name="music" color="#ff375f" size={24} width={48} height={48} background="#2c2c2e" radius={10} />
      <VStack align="start" spacing={4} fill>
        <Text weight="semibold" lines={1}>{d.title}</Text>
        <Text size={13} color={GRAY} lines={1}>{d.artist}</Text>
        <Progress start={d.startedAt} end={d.endsAt} color="#ff375f" />
      </VStack>
    </HStack>
  ),
  style: { background: '#1c1c1e', textColor: '#ffffff' },
});

// --- Running / run tracking -------------------------------------------------------------
export type RunData = {
  /** virtual start = now - active time (pauses excluded), so the system timer keeps counting */
  startAt: number;
  /** while paused: frozen elapsed time ("12:34"); a Timer can't be paused, so show text */
  pausedText?: string;
  distanceKm: number;
  pace: string;
  heartRate?: number;
};

const runTime = (d: RunData, size: number, width: number) =>
  d.pausedText ? (
    <Text size={size} weight="bold" color="#ff9f0a" monospacedDigits width={width} align="end">
      {d.pausedText}
    </Text>
  ) : (
    <Timer from={d.startAt} size={size} weight="bold" color={GREEN} width={width} align="end" />
  );

export const Run = defineLiveActivity<RunData>({
  name: 'running',
  compact: {
    leading: (d) => <Icon name={d.pausedText ? 'pause' : 'run'} color={GREEN} />,
    trailing: (d) => (
      <Text size={14} weight="semibold" color={GREEN} monospacedDigits>
        {d.distanceKm.toFixed(2)} km
      </Text>
    ),
  },
  minimal: () => <Icon name="run" color={GREEN} size={14} />,
  expanded: {
    leading: () => <Icon name="run" color={GREEN} size={26} />,
    center: (d) => (
      <Text weight="semibold">
        {d.distanceKm.toFixed(2)} km · {d.pace}/km
      </Text>
    ),
    trailing: (d) => runTime(d, 22, 84),
    bottom: (d) =>
      d.heartRate ? (
        <HStack>
          <Icon name="heart" color="#ff375f" size={14} />
          <Text size={14}>{d.heartRate} bpm</Text>
        </HStack>
      ) : null,
  },
  lockScreen: (d) => (
    <HStack>
      <Icon name="run" color={GREEN} size={24} />
      <VStack align="start" fill>
        <Text weight="semibold">{d.pausedText ? 'Đang tạm dừng' : 'Đang chạy bộ'}</Text>
        <Text size={13} color="#8e8e93" lines={1}>
          {d.distanceKm.toFixed(2)} km · {d.pace}/km{d.heartRate ? ` · ${d.heartRate} bpm` : ''}
        </Text>
      </VStack>
      {runTime(d, 26, 100)}
    </HStack>
  ),
  style: { background: '#101012', textColor: '#ffffff', keyline: GREEN },
});

// --- Upload / download progress -----------------------------------------------------------
export type UploadData = { file: string; progress: number };

export const Upload = defineLiveActivity<UploadData>({
  name: 'upload',
  compact: {
    leading: () => <Icon name="upload" color="#0a84ff" />,
    trailing: (d) => <Progress variant="ring" value={d.progress} color="#0a84ff" size={18} />,
  },
  minimal: (d) => <Progress variant="ring" value={d.progress} color="#0a84ff" size={18} />,
  expanded: {
    leading: () => <Icon name="upload" color="#0a84ff" size={26} />,
    center: (d) => <Text weight="semibold" lines={1}>{d.file}</Text>,
    trailing: (d) => <Text weight="bold" monospacedDigits>{Math.round(d.progress * 100)}%</Text>,
    bottom: (d) => <Progress value={d.progress} color="#0a84ff" thickness={6} />,
  },
  lockScreen: (d) => (
    <VStack align="start" spacing={8}>
      <HStack>
        <Icon name="upload" color="#0a84ff" />
        <Text weight="semibold" lines={1} fill>Đang tải lên {d.file}</Text>
        <Text weight="bold" monospacedDigits>{Math.round(d.progress * 100)}%</Text>
      </HStack>
      <Progress value={d.progress} color="#0a84ff" thickness={6} />
    </VStack>
  ),
  style: { background: '#101012', textColor: '#ffffff' },
});
