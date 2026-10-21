import { useEffect, useRef } from 'react';
import { AppRegistry, Platform } from 'react-native';

import { getNativeModule, type AndroidForegroundServiceType, type NativeActivityInfo } from './native';
import type { TimeValue } from './primitives';
import { islandStore } from './store';
import { byteLength, encodePayload, IOS_PAYLOAD_LIMIT, renderTemplate, type LiveActivityTemplate } from './template';

export interface DynamicIslandConfig {
  /**
   * Android: show the floating island over other apps. Needs `SYSTEM_ALERT_WINDOW` in the app's
   * manifest + the user's permission (requestOverlayPermission). Default false
   */
  androidOverlay: boolean;
  /** iOS: request push tokens for every activity by default. Default false */
  push: boolean;
  /** how long the in-app island stays expanded after an update with `alert` (ms, 0 = don't expand). Default 4000 */
  alertExpandDuration: number;
}

// Android: React Native pauses JS timers in the background unless a headless JS task is running.
// While an activity owns the foreground service (androidForegroundService), native holds this task
// open so setInterval-based tracking keeps running with the screen off. It never settles by design.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('LiveIslandKeepAlive', () => () => new Promise<void>(() => {}));
}

const config: DynamicIslandConfig = { androidOverlay: false, push: false, alertExpandDuration: 4000 };

/** Global defaults, call once at startup. */
export function configure(next: Partial<DynamicIslandConfig>) {
  Object.assign(config, next);
}

export interface StartOptions {
  /** start the system Live Activity / Android notification. Default true */
  native?: boolean;
  /** show it in the in-app island too. Default true */
  inApp?: boolean;
  /** in-app island ordering, higher wins. Default 0 */
  priority?: number;
  /** iOS: mark as outdated after this moment */
  staleAt?: TimeValue;
  /** iOS: ordering among several Live Activities (0..100) */
  relevance?: number;
  /** iOS: request a push token (see addPushTokenListener) */
  push?: boolean;
  /** Android: show the floating island. Defaults to configure({ androidOverlay }) */
  androidOverlay?: boolean;
  /**
   * Android: post the notification from a foreground service of this type, which keeps the app
   * process (and JS) alive in the background, e.g. 'location' for run / ride tracking. The app needs
   * `FOREGROUND_SERVICE` + the matching `FOREGROUND_SERVICE_<TYPE>` permission and, for 'location',
   * a granted location permission. Only one activity at a time can own the service.
   */
  androidForegroundService?: AndroidForegroundServiceType;
}

export interface UpdateOptions {
  /** iOS: light up the screen / expand the island with an alert. The in-app island expands briefly too. */
  alert?: { title: string; body: string };
  staleAt?: TimeValue;
  relevance?: number;
}

export interface EndOptions<D> {
  /** final data shown until dismissed */
  data?: D;
  /** 'default' keeps it on the lock screen for a while (iOS ≤ 4h), 'immediate' removes it now */
  dismiss?: 'default' | 'immediate' | TimeValue;
}

const ms = (t: TimeValue) => (t instanceof Date ? t.getTime() : t);
let localCounter = 0;

function encodeChecked(name: string, payload: ReturnType<typeof renderTemplate>) {
  const json = encodePayload(payload);
  if (Platform.OS === 'ios' && byteLength(json) > IOS_PAYLOAD_LIMIT) {
    console.warn(
      `[live-island] "${name}" renders to ${byteLength(json)} bytes; iOS limits Live Activities to ` +
        `${IOS_PAYLOAD_LIMIT}. Simplify the template (fewer nodes / shorter text) or the update will fail.`,
    );
  }
  return json;
}

export class LiveActivity<D> {
  private ended = false;

  constructor(
    readonly template: LiveActivityTemplate<D>,
    /** native activity id, or a local id when only shown in-app */
    readonly id: string,
    private current: D,
    private readonly native: boolean,
  ) {}

  get data(): D {
    return this.current;
  }

  get isActive(): boolean {
    return !this.ended;
  }

  /** Re-render with new data. Accepts a full object or an updater function. */
  async update(next: D | ((prev: D) => D), options: UpdateOptions = {}): Promise<void> {
    if (this.ended) return;
    this.current = typeof next === 'function' ? (next as (prev: D) => D)(this.current) : next;
    const payload = renderTemplate(this.template, this.current);
    islandStore.patch(this.id, { payload });
    if (options.alert && config.alertExpandDuration > 0) this.expand(config.alertExpandDuration);

    const module = getNativeModule();
    if (this.native && module) {
      await module.updateActivity(this.id, encodeChecked(this.template.name, payload), {
        alert: options.alert,
        staleDate: options.staleAt !== undefined ? ms(options.staleAt) : undefined,
        relevanceScore: options.relevance,
      });
    }
  }

  /** Expand it in the in-app island, optionally collapsing again after `autoCollapseMs`. */
  expand(autoCollapseMs?: number): void {
    if (this.ended) return;
    islandStore.setExpanded(this.id);
    if (autoCollapseMs) {
      setTimeout(() => {
        if (islandStore.getExpanded() === this.id) islandStore.setExpanded(null);
      }, autoCollapseMs);
    }
  }

  collapse(): void {
    if (islandStore.getExpanded() === this.id) islandStore.setExpanded(null);
  }

  /** Merge a partial object into the current data. */
  patch(partial: Partial<D>, options?: UpdateOptions): Promise<void> {
    return this.update((prev) => ({ ...prev, ...partial }), options);
  }

  async end(options: EndOptions<D> = {}): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    islandStore.remove(this.id);
    const module = getNativeModule();
    if (!this.native || !module) return;

    if (options.data !== undefined) this.current = options.data;
    const payload = options.data !== undefined ? encodeChecked(this.template.name, renderTemplate(this.template, options.data)) : null;
    const dismiss = options.dismiss ?? 'default';
    await module.endActivity(
      this.id,
      payload,
      dismiss === 'default' || dismiss === 'immediate'
        ? { dismissal: dismiss }
        : { dismissal: 'after', dismissAt: ms(dismiss) },
    );
  }
}

const running = new Map<string, LiveActivity<any>>();

export interface LiveActivityDefinition<D> {
  readonly template: LiveActivityTemplate<D>;
  /** Start a new activity of this template. */
  start(data: D, options?: StartOptions): Promise<LiveActivity<D>>;
  /**
   * Re-attach to a native activity that outlived the JS session (app killed and relaunched while
   * the Live Activity / notification kept running). Find ids with getNativeActivities().
   */
  attach(id: string, data: D, options?: Pick<StartOptions, 'inApp' | 'priority'>): LiveActivity<D>;
  /** Activities of this template started (or attached) in this JS session. */
  list(): LiveActivity<D>[];
  endAll(options?: EndOptions<D>): Promise<void>;
}

/**
 * Describe a Live Activity once; reuse it everywhere with different data.
 *
 * ```tsx
 * const Delivery = defineLiveActivity<{ eta: Date; driver: string }>({
 *   name: 'delivery',
 *   compact: { leading: () => <Icon name="car" />, trailing: (d) => <Timer to={d.eta} /> },
 *   expanded: { bottom: (d) => <Text>{d.driver} is on the way</Text> },
 *   lockScreen: (d) => <HStack>...</HStack>,
 * });
 * const activity = await Delivery.start({ eta, driver: 'Minh' });
 * await activity.patch({ driver: 'An' });
 * await activity.end();
 * ```
 */
export function defineLiveActivity<D>(template: LiveActivityTemplate<D>): LiveActivityDefinition<D> {
  return {
    template,
    async start(data, options = {}) {
      const payload = renderTemplate(template, data);
      const module = getNativeModule();
      const wantNative = options.native !== false && module !== null;

      let id = `local-${Date.now().toString(36)}-${(localCounter++).toString(36)}`;
      let nativeOverlay = false;
      let native = false;

      if (wantNative) {
        try {
          const result = await module!.startActivity(template.name, encodeChecked(template.name, payload), {
            staleDate: options.staleAt !== undefined ? ms(options.staleAt) : undefined,
            relevanceScore: options.relevance,
            push: options.push ?? config.push,
            overlay: options.androidOverlay ?? config.androidOverlay,
            foregroundService: options.androidForegroundService,
          });
          id = result.id;
          nativeOverlay = result.overlay;
          native = true;
        } catch (e) {
          // Live Activities disabled by the user, unsupported OS, notification permission missing…
          // The in-app island still works, so degrade instead of failing the whole flow.
          console.warn(`[live-island] Could not start native activity "${template.name}": ${(e as Error).message}`);
        }
      }

      const activity = new LiveActivity(template, id, data, native);
      running.set(id, activity);
      if (options.inApp !== false) {
        islandStore.upsert({
          id,
          name: template.name,
          payload,
          nativeOverlay,
          priority: options.priority ?? 0,
          startedAt: Date.now(),
        });
      }
      return activity;
    },
    attach(id, data, options = {}) {
      const existing = running.get(id);
      if (existing) return existing as LiveActivity<D>;
      const native = getNativeActivities().some((a) => a.id === id && a.name === template.name);
      const activity = new LiveActivity(template, id, data, native);
      running.set(id, activity);
      if (options.inApp !== false) {
        islandStore.upsert({
          id,
          name: template.name,
          payload: renderTemplate(template, data),
          nativeOverlay: false,
          priority: options.priority ?? 0,
          startedAt: Date.now(),
        });
      }
      return activity;
    },
    list() {
      return [...running.values()].filter((a) => a.template === template && a.isActive);
    },
    async endAll(options) {
      await Promise.all(this.list().map((a) => a.end(options)));
    },
  };
}

export function getActivity<D = unknown>(id: string): LiveActivity<D> | undefined {
  return running.get(id);
}

/** End every activity: in-app and native (including ones left over from a previous app launch). */
export async function endAllActivities(): Promise<void> {
  await Promise.all([...running.values()].map((a) => a.end({ dismiss: 'immediate' })));
  islandStore.clear();
  await getNativeModule()?.endAllActivities();
}

/** Native activities currently known to the OS (survive app restarts on iOS). */
export function getNativeActivities(): NativeActivityInfo[] {
  return (getNativeModule()?.getActivities() ?? []) as NativeActivityInfo[];
}

export function areActivitiesEnabled(): boolean {
  return getNativeModule()?.areActivitiesEnabled() ?? false;
}

// --- Android permissions -------------------------------------------------------------------

export function hasOverlayPermission(): boolean {
  return getNativeModule()?.hasOverlayPermission() ?? false;
}

/** Opens the "Display over other apps" settings page (Android). */
export async function requestOverlayPermission(): Promise<void> {
  await getNativeModule()?.requestOverlayPermission();
}

/** Android 13+ notification permission. Resolves true on iOS / older Android. */
export async function requestNotificationPermission(): Promise<boolean> {
  const module = getNativeModule();
  return module ? module.requestNotificationPermission() : true;
}

// --- Events --------------------------------------------------------------------------------

type Subscription = { remove(): void };
const noop: Subscription = { remove() {} };

export function addActivityStateListener(listener: (e: NativeActivityInfo) => void): Subscription {
  return getNativeModule()?.onActivityStateChange((e) => listener(e as NativeActivityInfo)) ?? noop;
}

/** iOS: push token of one activity, send it to your server to update it remotely. */
export function addPushTokenListener(listener: (e: { id: string; name: string; token: string }) => void): Subscription {
  return getNativeModule()?.onPushToken(listener) ?? noop;
}

/** iOS 17.2+: token that lets your server *start* activities remotely. */
export function addPushToStartTokenListener(listener: (e: { token: string }) => void): Subscription {
  return getNativeModule()?.onPushToStartToken(listener) ?? noop;
}

// Keep the in-app island in sync when the user dismisses an activity from the lock screen / notification.
let syncing: Subscription | undefined;
export function ensureNativeSync() {
  if (syncing) return;
  syncing = addActivityStateListener(({ id, state }) => {
    if (state === 'ended' || state === 'dismissed') {
      islandStore.remove(id);
      running.delete(id);
    }
  });
}

// --- React hook ------------------------------------------------------------------------------

/**
 * Declarative usage: the activity runs while `active` is true and re-renders when `data` changes.
 *
 * ```tsx
 * useLiveActivity(Upload, { progress }, { active: uploading });
 * ```
 */
export function useLiveActivity<D>(
  definition: LiveActivityDefinition<D>,
  data: D,
  options: StartOptions & { active?: boolean } = {},
): LiveActivity<D> | undefined {
  const { active = true } = options;
  const ref = useRef<Promise<LiveActivity<D>> | undefined>(undefined);
  const activityRef = useRef<LiveActivity<D> | undefined>(undefined);
  const latest = useRef({ data, options });
  latest.current = { data, options };

  useEffect(() => {
    if (!active) return;
    const pending = definition.start(latest.current.data, latest.current.options);
    ref.current = pending;
    pending.then((a) => {
      activityRef.current = a;
    });
    return () => {
      ref.current = undefined;
      activityRef.current = undefined;
      pending.then((a) => a.end());
    };
  }, [active, definition]);

  // Dates become ISO strings, so value changes are detected even for new object identities.
  const serialized = JSON.stringify(data);
  const lastSent = useRef(serialized);
  useEffect(() => {
    if (lastSent.current === serialized) return;
    lastSent.current = serialized;
    ref.current?.then((a) => a.update(latest.current.data));
  }, [serialized]);

  return activityRef.current;
}
