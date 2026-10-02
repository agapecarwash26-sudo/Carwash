import { getForcedOffline, listOperations, setLastSync, updateOperation } from './offline';
import { checkBackend } from './network';
import { executeOfflineOperation } from './workspace';

let running = false;

export async function synchronizeOfflineQueue(onProgress?: () => void) {
  if (running || await getForcedOffline() || !(await checkBackend())) return { synced: 0, failed: 0, skipped: true };
  running = true;
  let synced = 0; let failed = 0;
  try {
    const operations = (await listOperations()).filter(op => op.status === 'pending' || op.status === 'failed').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const op of operations) {
      await updateOperation(op.id, { status: 'processing', attempts: op.attempts + 1, lastAttemptAt: new Date().toISOString() });
      try {
        const result = await executeOfflineOperation(op);
        await updateOperation(op.id, { status: 'synced', result, error: undefined });
        synced += 1; onProgress?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateOperation(op.id, { status: 'failed', error: message });
        failed += 1; onProgress?.();
        if (/AUTH_SESSION_EXPIRED|permission|forbidden|JWT|401|403/i.test(message)) break;
      }
    }
    if (synced > 0) { await setLastSync(new Date().toISOString()); window.dispatchEvent(new CustomEvent('aquaflow-sync-complete')); }
    return { synced, failed, skipped: false };
  } finally { running = false; }
}

export function isSyncRunning() { return running; }
