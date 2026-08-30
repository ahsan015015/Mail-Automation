export const nf = new Intl.NumberFormat('en-US')
export const pf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export const number = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : nf.format(value))
export const compact = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M` : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value)
export const percent = (value: number | null | undefined): string => (value === null || value === undefined ? '—' : `${pf.format(value)}%`)

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function dateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function relative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—'
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return value
  const diff = Math.round((at - now) / 1000)
  const abs = Math.abs(diff)
  const future = diff > 0
  const unit = (amount: number, label: string) => (future ? `in ${amount}${label}` : `${amount}${label} ago`)
  if (abs < 45) return future ? 'in a moment' : 'just now'
  if (abs < 3600) return unit(Math.round(abs / 60), 'm')
  if (abs < 86_400) return unit(Math.round(abs / 3600), 'h')
  if (abs < 86_400 * 30) return unit(Math.round(abs / 86_400), 'd')
  return dateOnly(value)
}

/** 0 → 'now', 90 → '1h 30m', 2880 → '2d' */
export function duration(minutes: number): string {
  if (!minutes || minutes <= 0) return 'immediately'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = Math.round(minutes % 60)
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', mins ? `${mins}m` : ''].filter(Boolean).join(' ')
}

export const initials = (name: string, email = ''): string => {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export const firstNameOf = (contact: { name?: string; email: string }): string =>
  (contact.name || contact.email.split('@')[0] || '').split(/[\s._-]+/)[0] ?? ''

/** `2026-03-05T09:00` for datetime-local inputs, in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const fromLocalInput = (local: string): string | null => (local ? new Date(local).toISOString() : null)

export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${nf.format(count)} ${count === 1 ? singular : pluralForm}`

export function csvToClipboard(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0]!)
  return [columns.join('\t'), ...rows.map((row) => columns.map((column) => String(row[column] ?? '')).join('\t'))].join('\n')
}
