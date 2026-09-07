export type NetworkStatus = 'online' | 'backend_unavailable' | 'offline' | 'forced_offline';

import { getForcedOffline, setForcedOffline } from './offline';
import { supabase } from './supabase';

let lastBackendCheck: { ok: boolean; at: number } | null = null;

export function invalidateBackendCheck() {
  lastBackendCheck = null;
}

export async function checkInternet(timeoutMs = 3500): Promise<boolean> {
  if (!navigator.onLine) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://www.gstatic.com/generate_204', { method: 'GET', cache: 'no-store', mode: 'no-cors', signal: controller.signal });
    return response.type === 'opaque' || response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkBackend(timeoutMs = 4500): Promise<boolean> {
  if (await getForcedOffline()) return false;
  if (!navigator.onLine) return false;

  // Cache très court : un échec ne doit jamais bloquer le prochain retry.
  if (lastBackendCheck && Date.now() - lastBackendCheck.at < 1500) return lastBackendCheck.ok;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { error } = await supabase.from('services').select('id').limit(1).abortSignal(controller.signal);
    const ok = !error;
    lastBackendCheck = { ok, at: Date.now() };
    return ok;
  } catch {
    lastBackendCheck = { ok: false, at: Date.now() };
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function waitForBackend(options: { attempts?: number; delayMs?: number; timeoutMs?: number } = {}) {
  const { attempts = 5, delayMs = 1200, timeoutMs = 4500 } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await getForcedOffline() || !navigator.onLine) return false;
    invalidateBackendCheck();
    if (await checkBackend(timeoutMs)) return true;
    if (attempt < attempts - 1) await new Promise(resolve => window.setTimeout(resolve, delayMs));
  }
  return false;
}

export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (await getForcedOffline()) return 'forced_offline';
  if (!navigator.onLine) return 'offline';
  if (!(await checkInternet())) return 'offline';
  return (await checkBackend()) ? 'online' : 'backend_unavailable';
}

export async function setForcedOfflineMode(value: boolean) {
  await setForcedOffline(value);
  invalidateBackendCheck();
}
