export type OfflineOperationStatus = 'pending' | 'processing' | 'synced' | 'failed';

export type OfflineOperation = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  createdAt: string;
  status: OfflineOperationStatus;
  attempts: number;
  result?: unknown;
  error?: string;
  lastAttemptAt?: string;
  userId: string;
  siteId: string | null;
};

export type OfflineSnapshot = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  siteId: string | null;
  savedAt: string;
  expiresAt: string;
};

const DB_NAME = 'aquaflow-offline';
const DB_VERSION = 1;
const STORES = { operations: 'operations', cache: 'cache', meta: 'meta' } as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const operations = db.objectStoreNames.contains(STORES.operations)
        ? request.transaction!.objectStore(STORES.operations)
        : db.createObjectStore(STORES.operations, { keyPath: 'id' });
      if (!operations.indexNames.contains('status')) operations.createIndex('status', 'status', { unique: false });
      if (!operations.indexNames.contains('createdAt')) operations.createIndex('createdAt', 'createdAt', { unique: false });
      if (!db.objectStoreNames.contains(STORES.cache)) db.createObjectStore(STORES.cache, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('OFFLINE_QUEUE: IndexedDB indisponible.'));
  });
  return dbPromise;
}

export function isIndexedDbAvailable() { return typeof indexedDB !== 'undefined'; }

export async function putOperation(operation: OfflineOperation): Promise<void> {
  const db = await openDb();
  await tx(db, STORES.operations, 'readwrite', store => store.put(operation));
}

export async function getOperation(id: string): Promise<OfflineOperation | null> {
  const db = await openDb();
  return tx(db, STORES.operations, 'readonly', store => requestValue(store.get(id)));
}

export async function listOperations(status?: OfflineOperationStatus): Promise<OfflineOperation[]> {
  const db = await openDb();
  if (!status) return tx(db, STORES.operations, 'readonly', store => requestAll(store.getAll()));
  return tx(db, STORES.operations, 'readonly', store => requestAll(store.index('status').getAll(status)));
}

export async function countPendingOperations(): Promise<number> {
  return (await listOperations('pending')).length + (await listOperations('failed')).length;
}

export async function updateOperation(id: string, patch: Partial<OfflineOperation>): Promise<void> {
  const current = await getOperation(id);
  if (!current) return;
  await putOperation({ ...current, ...patch });
}

export async function removeOperation(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, STORES.operations, 'readwrite', store => store.delete(id));
}

export async function clearCacheOnly(): Promise<void> {
  const db = await openDb();
  await tx(db, STORES.cache, 'readwrite', store => store.clear());
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await tx(db, STORES.cache, 'readwrite', store => store.put({ key, value, savedAt: new Date().toISOString() }));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const row = await tx<{ key: string; value: T } | undefined>(db, STORES.cache, 'readonly', store => requestValue(store.get(key)));
  return row?.value ?? null;
}

export async function metaSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await tx(db, STORES.meta, 'readwrite', store => store.put({ key, value }));
}

export async function metaGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const row = await tx<{ key: string; value: T } | undefined>(db, STORES.meta, 'readonly', store => requestValue(store.get(key)));
  return row?.value ?? null;
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot) { return metaSet('offline_session', snapshot); }
export async function getOfflineSnapshot() { return metaGet<OfflineSnapshot>('offline_session'); }
export async function setForcedOffline(value: boolean) { return metaSet('forced_offline', value); }
export async function getForcedOffline() { return (await metaGet<boolean>('forced_offline')) ?? false; }
export async function setLastSync(value: string) { return metaSet('last_sync', value); }
export async function getLastSync() { return metaGet<string>('last_sync'); }

export function newOperationId() { return crypto.randomUUID(); }

function requestValue<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function requestAll<T>(request: IDBRequest<T[]>) { return requestValue(request); }
function tx<T = void>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | IDBRequest | T): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let value: T;
    try {
      const result = work(store);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => { value = result.result; };
        result.onerror = () => reject(result.error);
      } else if (result instanceof Promise) {
        result.then(v => { value = v; }).catch(reject);
      } else value = result;
    } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(value as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}
