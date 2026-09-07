import { getForcedOffline, listOperations, setLastSync, updateOperation, type OfflineOperation } from './offline';
import { invalidateBackendCheck, waitForBackend } from './network';
import { executeOfflineOperation } from './workspace';

let running = false;
const PROCESSING_RECOVERY_MS = 2 * 60 * 1000;

function recoverableProcessing(op: OfflineOperation) {
  if (op.status !== 'processing') return false;
  if (!op.lastAttemptAt) return true;
  return Date.now() - new Date(op.lastAttemptAt).getTime() >= PROCESSING_RECOVERY_MS;
}

function isNetworkError(error: unknown) {
  const e = error as { message?: string; status?: number };
  const message = String(e?.message ?? error ?? "");
  return /failed to fetch|network|fetch|timeout|abort|gateway|temporarily unavailable|service unavailable|connection|offline/i.test(message) || (!!e?.status && e.status >= 500);
}

function isAuthenticationError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error ?? '');
  return /AUTH_SESSION_EXPIRED|permission|forbidden|JWT|401|403/i.test(message);
}

export async function synchronizeOfflineQueue(onProgress?: () => void) {
  if (running) return { synced: 0, failed: 0, skipped: true, reason: 'already_running' };
  if (await getForcedOffline()) return { synced: 0, failed: 0, skipped: true, reason: 'forced_offline' };
  if (!navigator.onLine) return { synced: 0, failed: 0, skipped: true, reason: 'browser_offline' };

  running = true;
  let synced = 0;
  let failed = 0;

  try {
    invalidateBackendCheck();
    if (!(await waitForBackend({ attempts: 4, delayMs: 1000, timeoutMs: 4500 }))) {
      return { synced: 0, failed: 0, skipped: true, reason: 'backend_unavailable' };
    }

    const operations = (await listOperations())
      .filter(op => op.status === 'pending' || op.status === 'failed' || recoverableProcessing(op))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const op of operations) {
      if (!navigator.onLine || await getForcedOffline()) break;

      const attempt = op.attempts + 1;
      await updateOperation(op.id, {
        status: 'processing',
        attempts: attempt,
        lastAttemptAt: new Date().toISOString(),
        error: undefined,
      });

      try {
        const result = await executeOfflineOperation({ ...op, status: 'processing', attempts: attempt });
        await updateOperation(op.id, { status: 'synced', result, error: undefined });
        synced += 1;
        onProgress?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateOperation(op.id, { status: 'failed', error: message, lastAttemptAt: new Date().toISOString() });
        failed += 1;
        onProgress?.();

        if (isNetworkError(error)) {
          invalidateBackendCheck();
          break;
        }
        if (isAuthenticationError(error)) break;
        // Erreur métier : on continue avec l'opération suivante.
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
