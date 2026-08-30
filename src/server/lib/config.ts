import path from 'node:path'
import { loadEnvFile } from './dotenv.js'

loadEnvFile()

const str = (key: string, fallback = ''): string => {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}
const int = (key: string, fallback: number): number => {
  const v = Number.parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(v) ? v : fallback
}
const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  return /^(1|true|yes|on)$/i.test(v)
}

const env = str('NODE_ENV', 'development')

/** Bootstrap defaults. The `settings` table can override most of this at runtime. */
export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: int('PORT', 8787),
  host: str('HOST', '0.0.0.0'),
  /** Who may embed the app in an iframe. `'self'` by default; `*` allows any embedder (previews). */
  frameAncestors: str('FRAME_ANCESTORS', "'self'"),
  /** When empty the public base URL is derived from each request. */
  publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/+$/, ''),
  dbPath: path.resolve(str('DB_PATH', 'var/mail-automation.db')),
  mailDir: path.resolve(str('MAIL_DIR', 'var/mail')),
  sessionSecret: str('SESSION_SECRET') || 'dev-only-insecure-secret-change-me',
  sessionTtlHours: int('SESSION_TTL_HOURS', 720),
  /** Used to sign open/click/unsubscribe links. Derived from the session secret. */
  trackingSecret: str('TRACKING_SECRET') || `tracking:${str('SESSION_SECRET') || 'dev-only-insecure-secret-change-me'}`,
  bootstrapAdmin: {
    email: str('ADMIN_EMAIL', 'admin@maillocal.dev').toLowerCase(),
    password: str('ADMIN_PASSWORD', 'change-me-please'),
  },
  seedDemo: bool('SEED_DEMO', false),
  workspaceName: str('WORKSPACE_NAME', 'Mail Automation'),
  transport: (str('MAIL_TRANSPORT', 'auto') as 'auto' | 'smtp' | 'memory') || 'auto',
  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER'),
    password: str('SMTP_PASS'),
    pool: int('SMTP_POOL', 4),
    maxMessages: int('SMTP_MAX_MESSAGES', 50),
  },
  from: {
    name: str('FROM_NAME', 'Mail Automation'),
    email: str('FROM_EMAIL', 'noreply@example.com'),
    replyTo: str('REPLY_TO'),
  },
  engine: {
    tickMs: int('SEND_TICK_MS', 1000),
    ratePerMinute: int('SEND_RATE_PER_MINUTE', 30),
    dailyCap: int('SEND_DAILY_CAP', 2000),
    maxAttempts: int('SEND_MAX_ATTEMPTS', 4),
    backoffBaseSeconds: int('SEND_BACKOFF_BASE_SECONDS', 30),
    windowStartHour: process.env.SEND_WINDOW_START ? int('SEND_WINDOW_START', 9) : null,
    windowEndHour: process.env.SEND_WINDOW_END ? int('SEND_WINDOW_END', 18) : null,
    timezone: str('TZ_NAME', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
  },
  tracking: {
    openTracking: bool('TRACK_OPENS', true),
    clickTracking: bool('TRACK_CLICKS', true),
    includeUnsubscribe: bool('INCLUDE_UNSUB', true),
    trackDomain: str('TRACK_DOMAIN'),
  },
} as const

export type AppConfig = typeof config
