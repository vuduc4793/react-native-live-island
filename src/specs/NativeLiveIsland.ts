import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * TurboModule contract (codegen: package.json → codegenConfig). Implemented by
 * ios/LiveIsland.mm + ios/LiveIslandImpl.swift and android/.../LiveIslandModule.kt.
 * Payloads are JSON strings of `WirePayload` (src/schema.ts).
 */

export type ActivityStateEvent = {
  id: string;
  name: string;
  /** active | ended | dismissed | stale | pending */
  state: string;
};

export type PushTokenEvent = {
  id: string;
  name: string;
  token: string;
};

export type PushToStartTokenEvent = {
  token: string;
};

export type ActivityInfo = {
  id: string;
  name: string;
  state: string;
};

export type StartResult = {
  id: string;
  /** Android: the floating island is showing this activity */
  overlay: boolean;
};

export interface Spec extends TurboModule {
  areActivitiesEnabled(): boolean;
  /**
   * options: { staleDate?: number; relevanceScore?: number; push?: boolean;
   *            overlay?: boolean; foregroundService?: 'location' | 'dataSync' | ... }
   */
  startActivity(name: string, payload: string, options: CodegenTypes.UnsafeObject): Promise<StartResult>;
  /** options: { staleDate?: number; relevanceScore?: number; alert?: { title: string; body: string } } */
  updateActivity(id: string, payload: string, options: CodegenTypes.UnsafeObject): Promise<void>;
  /** options: { dismissal: 'default' | 'immediate' | 'after'; dismissAt?: number } */
  endActivity(id: string, payload: string | null, options: CodegenTypes.UnsafeObject): Promise<void>;
  endAllActivities(): Promise<void>;
  getActivities(): Array<ActivityInfo>;

  /** Android only (iOS: false / no-op) */
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): Promise<void>;
  /** Android 13+: asks for POST_NOTIFICATIONS. iOS: resolves areActivitiesEnabled() */
  requestNotificationPermission(): Promise<boolean>;

  /**
   * Icon for the in-app island, rendered natively so it matches the Live Activity / notification
   * (SF Symbol on iOS, built-in drawable on Android). Returns a `data:image/png;base64,…` URI or null.
   * `size` in points/dp, `color` ARGB uint32.
   */
  iconImage(name: string, android: string | null, size: number, color: number): string | null;

  readonly onActivityStateChange: CodegenTypes.EventEmitter<ActivityStateEvent>;
  readonly onPushToken: CodegenTypes.EventEmitter<PushTokenEvent>;
  readonly onPushToStartToken: CodegenTypes.EventEmitter<PushToStartTokenEvent>;
}

export default TurboModuleRegistry.get<Spec>('LiveIsland');
