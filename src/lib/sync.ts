import { getForcedOffline, listOperations, setLastSync, updateOperation } from './offline';
import { checkBackend } from './network';
import { executeOfflineOperation } from './workspace';

let running = false;
let autoSyncTimer: number | null = null;
let autoSyncStarted = false;

const RETRY_INTERVAL_MS = 15000;

function isOnlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function emitProgress(onProgress?: () => void) {
  try { onProgress?.(); } catch { /* UI callback must never stop queue processing. */ }
}

export async function synchronizeOfflineQueue(onProgress?: () => void) {
  if (running) return { synced: 0, failed: 0, skipped: true };
  if (await getForcedOffline()) return { synced: 0, failed: 0, skipped: true };
  if (!isOnlineNow()) return { synced: 0, failed: 0, skipped: true };

  // navigator.onLine can become true before the API is really reachable.
  // In that case the caller/automatic retry will try again later.
  if (!(await checkBackend(4500, true))) return { synced: 0, failed: 0, skipped: true };

  running = true;
  let synced = 0;
  let failed = 0;

  try {
    // Recover an operation left in `processing` by a tab crash, refresh or
    // connection loss that happened between the local status update and the RPC.
    const allOperations = await listOperations();
    const now = Date.now();
    const staleProcessing = allOperations.filter(op =>
      op.status === 'processing' &&
      (!op.lastAttemptAt || now - new Date(op.lastAttemptAt).getTime() > 60000),
    );

    for (const op of staleProcessing) {
      await updateOperation(op.id, {
        status: 'pending',
        error: op.error || 'Reprise automatique après interruption de synchronisation.',
      }).catch(() => {});
    }

    // Re-read after recovery so we work from the latest IndexedDB state.
    const operations = (await listOperations())
      .filter(op => op.status === 'pending' || op.status === 'failed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const op of operations) {
      // Do not keep calling Supabase when connectivity disappears mid-loop.
      if (await getForcedOffline() || !isOnlineNow()) break;

      try {
        await updateOperation(op.id, {
          status: 'processing',
          attempts: op.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          error: undefined,
        });

        const result = await executeOfflineOperation(op);

        // Keep the local operation as `synced` rather than deleting it. The
        // server-side operation_id provides idempotency if a response was lost.
        await updateOperation(op.id, { status: 'synced', result, error: undefined });
        synced += 1;
        emitProgress(onProgress);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // One bad item must not block the rest of the queue.
        await updateOperation(op.id, {
          status: 'failed',
          error: message,
          lastAttemptAt: new Date().toISOString(),
        }).catch(() => {});

        failed += 1;
        emitProgress(onProgress);
      }
    }

    if (synced > 0) {
      await setLastSync(new Date().toISOString());
      window.dispatchEvent(new CustomEvent('aquaflow-sync-complete'));
    }

    return { synced, failed, skipped: false };
  } finally {
    running = false;
  }
}

export function isSyncRunning() {
  return running;
}

export function startAutomaticOfflineSync(onProgress?: () => void) {
  if (autoSyncStarted || typeof window === 'undefined') return () => {};
  autoSyncStarted = true;

  const trigger = () => {
    // The actual backend check is intentionally inside synchronizeOfflineQueue.
    // This allows retry after `online` fires too early.
    void synchronizeOfflineQueue(onProgress).catch(() => {});
  };

  const onOnline = () => trigger();
  const onFocus = () => trigger();
  const onPageShow = () => trigger();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') trigger();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);

  autoSyncTimer = window.setInterval(trigger, RETRY_INTERVAL_MS);
  trigger();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (autoSyncTimer !== null) {
      window.clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    autoSyncStarted = false;
  };
}
