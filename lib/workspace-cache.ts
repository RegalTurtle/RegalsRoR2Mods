// Browser caching is optional; MongoDB persistence must keep working when the
// browser quota is full or storage is disabled. Never delete another cache key.
export function readWorkspaceCache(storage: Pick<Storage, "getItem">, key: string) {
  try { return storage.getItem(key); } catch { return null; }
}

export function writeWorkspaceCache(storage: Pick<Storage, "setItem">, key: string, full: unknown, compact: unknown) {
  try {
    storage.setItem(key, JSON.stringify(full));
    return true;
  } catch {
    try { storage.setItem(key, JSON.stringify(compact)); return true; }
    catch { return false; }
  }
}
