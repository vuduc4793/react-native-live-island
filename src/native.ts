import { Platform } from 'react-native';

import type { ActivityInfo, Spec } from './specs/NativeLiveIsland';

/**
 * Typed view of the TurboModule "LiveIsland" (src/specs/NativeLiveIsland.ts). The spec takes
 * options as untyped objects (codegen), these interfaces document what native reads.
 */
export interface NativeStartOptions {
  /** epoch ms after which the system marks the activity as stale (iOS) */
  staleDate?: number;
  /** iOS: ordering among several activities, higher wins the Dynamic Island */
  relevanceScore?: number;
  /** iOS: request a push token so a server can update the activity */
  push?: boolean;
  /** Android: also show the floating island overlay (needs "display over other apps") */
  overlay?: boolean;
  /** Android: host the notification in a foreground service of this type (e.g. 'location') */
  foregroundService?: AndroidForegroundServiceType;
  /** Android: 'standard' = system notification template only, no custom RemoteViews */
  notificationStyle?: AndroidNotificationStyle;
}

/**
 * Android notification look. 'auto' draws the template with custom views when this device can
 * inflate them (checked before every post) and falls back to the standard template otherwise.
 * 'standard' always uses the system template (title, text, chronometer, progress).
 */
export type AndroidNotificationStyle = 'auto' | 'standard';

/** Android foreground service types the library's service can run as. */
export type AndroidForegroundServiceType = 'location' | 'dataSync' | 'mediaPlayback' | 'connectedDevice' | 'health' | 'shortService';

export interface NativeUpdateOptions {
  staleDate?: number;
  relevanceScore?: number;
  /** iOS: light up the island / screen with an alert while updating */
  alert?: { title: string; body: string };
}

export interface NativeEndOptions {
  dismissal: 'default' | 'immediate' | 'after';
  /** epoch ms, with dismissal "after" */
  dismissAt?: number;
}

export interface NativeActivityInfo extends ActivityInfo {
  state: 'active' | 'ended' | 'dismissed' | 'stale' | 'pending';
}

let cached: Spec | null | undefined;

/** Returns null on web, in tests, or when the app wasn't rebuilt after installing the library. */
export function getNativeModule(): Spec | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return (cached = null);
  try {
    cached = (require('./specs/NativeLiveIsland') as { default: Spec | null }).default ?? null;
  } catch {
    cached = null;
  }
  return cached;
}
