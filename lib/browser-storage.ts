type StorageScope = 'local' | 'session';

function getStorage(scope: StorageScope): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return scope === 'session' ? window.sessionStorage : window.localStorage;
  } catch (error) {
    console.error(`[storage] Failed to access ${scope}Storage`, error);
    return null;
  }
}

export function readStorage(key: string, scope: StorageScope = 'local'): string | null {
  const storage = getStorage(scope);
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch (error) {
    console.error(`[storage] Failed to read "${key}"`, error);
    return null;
  }
}

export function writeStorage(key: string, value: string, scope: StorageScope = 'local'): boolean {
  const storage = getStorage(scope);
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`[storage] Failed to write "${key}"`, error);
    return false;
  }
}

export function removeStorage(key: string, scope: StorageScope = 'local'): boolean {
  const storage = getStorage(scope);
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`[storage] Failed to remove "${key}"`, error);
    return false;
  }
}

export function readJsonStorage<T>(key: string, fallback: T, scope: StorageScope = 'local'): T {
  const raw = readStorage(key, scope);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[storage] Failed to parse "${key}"`, error);
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown, scope: StorageScope = 'local'): boolean {
  try {
    return writeStorage(key, JSON.stringify(value), scope);
  } catch (error) {
    console.error(`[storage] Failed to serialize "${key}"`, error);
    return false;
  }
}
