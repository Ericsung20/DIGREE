import {useSyncExternalStore} from 'react';

// ponytail: localStorage stands in for the database while the app runs in mock mode (one "user" per browser).
// The files that import this are the ones to swap for Supabase queries.
const listeners = new Set<() => void>();
const cache = new Map<string, {raw: string | null; value: unknown}>();

export function readStore<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T; // same reference between renders
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback; // corrupt entry: start over rather than crash
    }
  }
  cache.set(key, {raw, value});
  return value;
}

export function writeStore<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// Remote mode (Supabase): the same subscribe/notify plumbing over an in-memory cache.
// A key is fetched once on first use; mutations write to Supabase and then update the cache.
const memory = new Map<string, unknown>();
const loading = new Map<string, Promise<unknown>>();

export const getRemote = <T,>(key: string, fallback: T): T => (memory.has(key) ? (memory.get(key) as T) : fallback);
export function setRemote<T>(key: string, value: T): void {
  loading.delete(key);
  memory.set(key, value);
  listeners.forEach((l) => l());
}
/** Drop everything cached for the previous user. Call on sign-in and sign-out. */
export function resetRemote(): void {
  memory.clear();
  loading.clear();
  listeners.forEach((l) => l());
}
export function useRemote<T>(key: string, fallback: T, load: () => Promise<T>): T {
  return useSyncExternalStore(
    (listener) => {
      if (!memory.has(key) && !loading.has(key)) {
        const pending = load();
        loading.set(key, pending);
        pending
          .then((value) => {
            if (loading.get(key) === pending) setRemote(key, value);
          })
          .catch((e) => {
            if (loading.get(key) === pending) loading.delete(key);
            console.error(`Loading ${key} failed`, e);
          });
      }
      return subscribe(listener);
    },
    () => getRemote(key, fallback),
    () => fallback,
  );
}

/** `fallback` must be a stable reference (module constant or null). */
export function useStore<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => readStore(key, fallback),
    () => fallback,
  );
}
