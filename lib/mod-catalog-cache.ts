// Only public Thunderstore catalog data belongs here, never account/workspace data.
export const CATALOG_MAX_AGE = 6 * 60 * 60 * 1000;
type Snapshot<T> = { mods: T[]; updatedAt: number };
let memory: Snapshot<unknown> | null = null;
let pending: Promise<Snapshot<unknown>> | null = null;

async function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("regals-public-mod-catalog", 1);
      const timer = setTimeout(() => resolve(null), 3000);
      request.onupgradeneeded = () => { request.result.createObjectStore("catalog"); };
      request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
      request.onerror = () => { clearTimeout(timer); resolve(null); };
      request.onblocked = () => { clearTimeout(timer); resolve(null); };
    } catch { resolve(null); }
  });
}

export async function readModCatalog<T>(): Promise<Snapshot<T> | null> {
  if (memory) return memory as Snapshot<T>;
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction("catalog", "readonly");
      const request = transaction.objectStore("catalog").get("mods");
      request.onsuccess = () => {
        const value = request.result;
        if (value && Array.isArray(value.mods) && Number.isFinite(value.updatedAt)) memory = value;
        resolve(memory as Snapshot<T> | null);
      };
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}

async function persist(snapshot: Snapshot<unknown>) {
  const db = await database();
  if (!db) return;
  try {
    const transaction = db.transaction("catalog", "readwrite");
    transaction.objectStore("catalog").put(snapshot, "mods");
    transaction.oncomplete = transaction.onabort = () => db.close();
    // Cache failures must not interrupt use of the in-memory catalog.
    transaction.onerror = () => {};
  } catch { db.close(); }
}

export function refreshModCatalog<T>(loader: () => Promise<T[]>): Promise<Snapshot<T>> {
  if (!pending) {
    pending = loader().then((mods) => {
      const snapshot = { mods, updatedAt: Date.now() };
      memory = snapshot;
      void persist(snapshot);
      return snapshot;
    }).finally(() => { pending = null; });
  }
  return pending as Promise<Snapshot<T>>;
}
