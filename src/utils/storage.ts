/**
 * storage.ts — launch-safe storage adapter.
 *
 * It keeps a small in-memory mirror for synchronous reads and persists through
 * Expo-compatible AsyncStorage. Avoiding a JSI storage dependency keeps the
 * native launch path resilient across TestFlight builds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const mmkv = null;

const memoryStore = new Map<string, string>();

/** AsyncStorage-compatible wrapper — drop-in replacement. */
export const FastStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const memVal = memoryStore.get(key);
      if (memVal !== undefined) return memVal;
      const stored = await AsyncStorage.getItem(key);
      if (stored !== null) memoryStore.set(key, stored);
      return stored;
    } catch {
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      memoryStore.set(key, value);
      await AsyncStorage.setItem(key, value);
    } catch {}
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      memoryStore.delete(key);
      await AsyncStorage.removeItem(key);
    } catch {}
  },

  /** Synchronous read — use where await is impractical. */
  getSync: (key: string): string | null => {
    try {
      return memoryStore.get(key) ?? null;
    } catch {
      return null;
    }
  },

  /** Synchronous write. */
  setSync: (key: string, value: string): void => {
    try {
      memoryStore.set(key, value);
      AsyncStorage.setItem(key, value).catch(() => {});
    } catch {}
  },

  clear: async (): Promise<void> => {
    try {
      memoryStore.clear();
      await AsyncStorage.clear();
    } catch {}
  },
};
