/* Small, dependency-free helpers used across the server. */

export const nowIso = (): string => new Date().toISOString()

export const isoOf = (value: Date | string | number): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export function addMinutes(date: Date | string | number, minutes: number): Date {
  return new Date(new Date(date).getTime() + minutes * 60_000)
}

export function addSeconds(date: Date | string | number, seconds: number): Date {
  return new Date(new Date(date).getTime() + seconds * 1000)
}

export const clampInt = (value: unknown, min: number, max: number, fallback = min): number => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const round = (value: number, digits = 1): number => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** percentage of `total` that `part` represents, 0-100, rounded to 1 decimal */
export function rate(part: number, total: number): number {
  if (!total || total <= 0) return 0
  return round((part / total) * 100, 1)
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string') return (value as T) ?? fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch {
    return fallback
  }
}

export const toJson = (value: unknown): string => JSON.stringify(value ?? null)

export const bool = (value: unknown): boolean => value === 1 || value === true || value === '1' || value === 'true'

export function uniqueBy<T>(items: T[], key: (item: T) => string | number): T[] {
  const seen = new Set<string | number>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

export function truncate(value: string, max = 120): string {
  const oneLine = String(value ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, Math.max(0, max - 1))}…`
}

/** `2026-03-05T10:00:00.000Z` → `2026-03-05T10:00:00` truncated to the hour key */
export function hourKey(iso: string): string {
  return String(iso ?? '').slice(0, 13)
}

/** Local hour (0-23) of an ISO instant in the given IANA timezone. */
export function localHour(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
      weekday: 'short',
    }).formatToParts(date)
    const hour = parts.find((p) => p.type === 'hour')?.value
    return Number(hour ?? date.getUTCHours())
  } catch {
    return date.getUTCHours()
  }
}

/** true when the given timezone is currently on Saturday or Sunday */
export function localWeekend(date: Date, timezone: string): boolean {
  return ['Sat', 'Sun'].includes(localWeekday(date, timezone))
}

export function localWeekday(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
  } catch {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]!
  }
}

export class HttpError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details)
export const unauthorized = (message = 'Authentication required') => new HttpError(401, message)
export const forbidden = (message = 'Not allowed') => new HttpError(403, message)
export const notFound = (message = 'Not found') => new HttpError(404, message)
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details)
