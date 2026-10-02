/**
 * Business timezone for all operational dates/statistics.
 * Supabase stores instants in UTC; the UI and reporting calendar are Lubumbashi time.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Lubumbashi';

type DatePart = { type: string; value: string };

function parts(value: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).map((p: DatePart) => [p.type, p.value]));
}

/** Convert a business-calendar wall-clock date/time into a UTC instant. */
export function businessDateTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const p = parts(new Date(guess));
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess += target - represented;
  }
  return new Date(guess);
}

export function businessDayBounds(value = new Date()): { start: Date; end: Date } {
  const p = parts(value);
  const start = businessDateTimeToUtc(Number(p.year), Number(p.month), Number(p.day));
  const next = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1));
  const end = businessDateTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { start, end };
}

export function businessCalendarDate(value = new Date()): string {
  const p = parts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

export function businessDateFromInput(value: string, endOfDay = false): Date {
  const [year, month, day] = value.split('-').map(Number);
  return businessDateTimeToUtc(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
}

export function formatBusinessDate(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
    ...options,
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatBusinessTime(value: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(value instanceof Date ? value : new Date(value));
}
