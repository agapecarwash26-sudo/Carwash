import { getForcedOffline, listOperations, setLastSync, updateOperation } from './offline';
import { checkBackend } from './network';
import { executeOfflineOperation } from './workspace';

let running = false;

/**
 * Drains the durable IndexedDB queue. Operations left in `processing` by a
 * browser crash/close are recovered after a short lease. The server-side RPC
 * remains the final idempotency authority.
 */
export async function synchronizeOfflineQueue(onProgress?: () => void) {
  if (running || await getForcedOffline() || !(await checkBackend())) {
    return { synced: 0, failed: 0, skipped: true };
  }

  running = true;
  let synced = 0;
  let failed = 0;

  try {
    const now = Date.now();
    const all = await listOperations();
    const operations = all
      .filter(op => {
        if (op.status === 'pending' || op.status === 'failed') return true;
        if (op.status === 'processing') {
          const started = op.lastAttemptAt ? Date.parse(op.lastAttemptAt) : 0;
          return !started || now - started > 2 * 60 * 1000;
        }
        return false;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const op of operations) {
      if (await getForcedOffline() || !(await checkBackend())) break;

      await updateOperation(op.id, {
        status: 'processing',
        attempts: op.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
      });

      try {
        // IMPORTANT: keep op.id unchanged across every retry.
        // process_offline_operation() is idempotent on this UUID.
        const result = await executeOfflineOperation(op);
        await updateOperation(op.id, { status: 'synced', result, error: undefined });
        synced += 1;
        onProgress?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateOperation(op.id, { status: 'failed', error: message });
        failed += 1;
        onProgress?.();

        // Auth/permission errors cannot be fixed by retrying immediately.
        if (/AUTH_SESSION_EXPIRED|permission|forbidden|JWT|401|403/i.test(message)) break;
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

export function isSyncRunning() { return running; }
