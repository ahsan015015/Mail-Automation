import { config } from '../lib/config.js'
import { getDb } from '../db/sqlite.js'
import { jsonParse, nowIso, toJson } from '../lib/util.js'
import type { SmtpSettings, WorkspaceSettings } from '../../shared/types.js'

const KEY = 'workspace'

export interface StoredSettings {
  workspaceName: string
  fromName: string
  fromEmail: string
  replyTo: string
  transport: 'auto' | 'smtp' | 'memory'
  smtp: SmtpSettings
  sending: WorkspaceSettings['sending']
  tracking: WorkspaceSettings['tracking']
}

export type ResolvedSettings = StoredSettings

function defaults(): StoredSettings {
  return {
    workspaceName: config.workspaceName,
    fromName: config.from.name,
    fromEmail: config.from.email,
    replyTo: config.from.replyTo,
    transport: config.transport,
    smtp: { ...config.smtp },
    sending: { ...config.engine },
    tracking: { ...config.tracking },
  }
}

/** env defaults <- stored overrides */
export function getSettings(): ResolvedSettings {
  const base = defaults()
  const row = getDb().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY)
  if (!row) return base
  const stored = jsonParse<Partial<StoredSettings>>(row.value, {})
  return {
    ...base,
    ...strip(stored),
    smtp: { ...base.smtp, ...strip(stored.smtp ?? {}), password: stored.smtp?.password ?? base.smtp.password },
    sending: { ...base.sending, ...strip(stored.sending ?? {}) },
    tracking: { ...base.tracking, ...strip(stored.tracking ?? {}) },
  }
}

/** drop undefined/null/'' values so partial form saves never reset fields */
function strip<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value === '' && key !== 'replyTo' && key !== 'host' && key !== 'user' && key !== 'password' && key !== 'trackDomain') {
      continue
    }
    out[key] = value
  }
  return out as Partial<T>
}

function read(): StoredSettings | null {
  const row = getDb().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY)
  return row ? jsonParse<StoredSettings | null>(row.value, null) : null
}

function write(value: StoredSettings): void {
  getDb().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    KEY,
    toJson(value),
    nowIso(),
  )
}

export type SettingsPatch = Partial<Omit<StoredSettings, 'smtp' | 'sending' | 'tracking'>> & {
  smtp?: Partial<SmtpSettings>
  sending?: Partial<StoredSettings['sending']>
  tracking?: Partial<StoredSettings['tracking']>
}

/** Applies a (possibly partial) patch and returns the masked view. */
export function updateSettings(patch: SettingsPatch): WorkspaceSettings {
  const current = getSettings()
  const next: StoredSettings = {
    ...current,
    ...strip(patch as Record<string, unknown>) as Partial<StoredSettings>,
    smtp: { ...current.smtp, ...strip(patch.smtp ?? {}) as Partial<SmtpSettings> },
    sending: { ...current.sending, ...strip(patch.sending ?? {}) as Partial<StoredSettings['sending']> },
    tracking: { ...current.tracking, ...strip(patch.tracking ?? {}) as Partial<StoredSettings['tracking']> },
  }
  // An empty password field means "leave the stored credential untouched".
  if (!patch.smtp?.password) next.smtp.password = current.smtp.password
  else next.smtp.password = patch.smtp.password

  write(next)
  return publicSettings(next)
}

/** 'smtp' only when a host is configured, otherwise the local mail catcher. */
export function activeTransport(settings = getSettings()): 'smtp' | 'memory' {
  if (settings.transport === 'smtp') return 'smtp'
  if (settings.transport === 'memory') return 'memory'
  return settings.smtp.host ? 'smtp' : 'memory'
}

export function publicSettings(settings = getSettings()): WorkspaceSettings {
  const { password, ...smtp } = settings.smtp
  return {
    workspaceName: settings.workspaceName,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    transport: settings.transport,
    smtp: { ...smtp, hasPassword: Boolean(password) },
    sending: { ...settings.sending },
    tracking: { ...settings.tracking },
  }
}

export function smtpSettings(): SmtpSettings {
  return getSettings().smtp
}

export function resetSettings(): void {
  getDb().run('DELETE FROM settings WHERE key = ?', KEY)
}

export const settingsUpdatedAt = (): string | null =>
  getDb().get<{ updated_at: string }>('SELECT updated_at FROM settings WHERE key = ?', KEY)?.updated_at ?? null
