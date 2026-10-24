export const BUSINESS_TIME_ZONE = 'Africa/Lubumbashi' as const;

/** Returns the business calendar date (YYYY-MM-DD), never the device's local date. */
export function businessDateKey(value: Date | string | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatBusinessDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatBusinessDate(value: Date | string | number = new Date()): string {
  return formatBusinessDateTime(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Converts a business calendar date into the UTC interval used by Supabase.
 * Lubumbashi is UTC+02:00; keeping this conversion here prevents every
 * component from inventing its own device-local midnight.
 */
export function businessDayUtcRange(dateKey: string): { startUtc: string; endUtc: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Date métier invalide: ${dateKey}`);
  const [, y, m, d] = match;
  const start = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0));
  start.setUTCHours(start.getUTCHours() - 2);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function businessDateInputToUtc(dateKey: string, endOfDay = false): string {
  const range = businessDayUtcRange(dateKey);
  return endOfDay ? range.endUtc : range.startUtc;
}

export function addBusinessDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Date métier invalide: ${dateKey}`);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

/** Converts an HTML datetime-local value entered as Lubumbashi business time to UTC. */
export function businessDateTimeLocalToUtc(value: string): string {
  if (!value) throw new Error('Date/heure métier requise.');
  const normalized = value.length === 16 ? `${value}:00` : value;
  return new Date(`${normalized}+02:00`).toISOString();
}
