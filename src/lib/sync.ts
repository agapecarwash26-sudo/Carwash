import {
  getForcedOffline,
  listOperations,
  setLastSync,
  updateOperation,
} from './offline';
import { checkBackend } from './network';
import { executeOfflineOperation } from './workspace';

let running = false;

export async function synchronizeOfflineQueue(onProgress?: () => void) {
  if (running) return { synced: 0, failed: 0, skipped: true };
  if (await getForcedOffline()) return { synced: 0, failed: 0, skipped: true };
  if (!navigator.onLine) return { synced: 0, failed: 0, skipped: true };

  // "online" ne garantit pas encore que Supabase soit joignable.
  // On retente brièvement avant d'abandonner cette passe.
  let backendReady = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await checkBackend(5000)) {
      backendReady = true;
      break;
    }
    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  if (!backendReady) return { synced: 0, failed: 0, skipped: true };

  running = true;
  let synced = 0;
  let failed = 0;

  try {
    const now = Date.now();
    const allOperations = await listOperations();

    // Une opération restée en "processing" après une fermeture/plantage
    // du navigateur est récupérée après 2 minutes. Le même operationId
    // est réutilisé afin que le RPC Supabase reste idempotent.
    for (const op of allOperations) {
      if (op.status !== 'processing') continue;
      const lastAttempt = op.lastAttemptAt ? Date.parse(op.lastAttemptAt) : Date.parse(op.createdAt);
      if (Number.isFinite(lastAttempt) && now - lastAttempt > 2 * 60 * 1000) {
        await updateOperation(op.id, {
          status: 'pending',
          error: undefined,
        });
      }
    }

    const operations = (await listOperations())
      .filter(op => op.status === 'pending' || op.status === 'failed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const op of operations) {
      if (!navigator.onLine) break;

      await updateOperation(op.id, {
        status: 'processing',
        attempts: op.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        error: undefined,
      });

      try {
        const result = await executeOfflineOperation(op);

        // Succès confirmé par le RPC Supabase : l'opération locale
        // n'est plus comptée comme "en attente".
        await updateOperation(op.id, {
          status: 'synced',
          result,
          error: undefined,
        });

        synced += 1;
        onProgress?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        await updateOperation(op.id, {
          status: 'failed',
          error: message,
        });

        failed += 1;
        onProgress?.();

        if (/AUTH_SESSION_EXPIRED|permission|forbidden|JWT|401|403/i.test(message)) break;
        if (/network|failed to fetch|fetch|timeout|abort|connection|offline|gateway|service unavailable/i.test(message)) break;
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
