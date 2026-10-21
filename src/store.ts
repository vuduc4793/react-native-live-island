import type { WirePayload } from './schema';

/** An activity as seen by the in-app island. */
export interface IslandEntry {
  /** activity id (native id when a native activity exists) */
  id: string;
  /** template name */
  name: string;
  payload: WirePayload;
  /** Android: the native floating island already shows this activity */
  nativeOverlay: boolean;
  /** higher wins the main island slot; ties go to the most recent */
  priority: number;
  startedAt: number;
}

type Listener = () => void;

/**
 * Tiny external store (useSyncExternalStore-compatible) holding the activities currently alive.
 * Kept free of React / React Native imports so it can be unit-tested in plain Node.
 */
export function createIslandStore() {
  let entries: IslandEntry[] = [];
  let expandedId: string | null = null;
  const listeners = new Set<Listener>();

  const emit = () => listeners.forEach((l) => l());
  const sort = (list: IslandEntry[]) =>
    [...list].sort((a, b) => b.priority - a.priority || b.startedAt - a.startedAt);

  return {
    getSnapshot: (): readonly IslandEntry[] => entries,
    /** id of the activity expanded in the in-app island */
    getExpanded: (): string | null => expandedId,
    setExpanded(id: string | null) {
      if (expandedId === id) return;
      expandedId = id;
      emit();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    upsert(entry: IslandEntry) {
      const exists = entries.some((e) => e.id === entry.id);
      entries = sort(exists ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry]);
      emit();
    },
    patch(id: string, patch: Partial<Omit<IslandEntry, 'id'>>) {
      if (!entries.some((e) => e.id === id)) return;
      entries = sort(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      emit();
    },
    remove(id: string) {
      if (!entries.some((e) => e.id === id)) return;
      entries = entries.filter((e) => e.id !== id);
      if (expandedId === id) expandedId = null;
      emit();
    },
    clear() {
      if (entries.length === 0) return;
      entries = [];
      expandedId = null;
      emit();
    },
  };
}

export type IslandStore = ReturnType<typeof createIslandStore>;

/** Store shared by defineLiveActivity() and <DynamicIslandProvider />. */
export const islandStore = createIslandStore();
