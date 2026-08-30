import nodemailer, { type SendMailOptions } from 'nodemailer'
import { logger } from '../lib/log.js'
import { activeTransport, getSettings, type ResolvedSettings } from './settings.js'

export interface DeliverInput {
  to: { address: string; name?: string }
  from: { address: string; name?: string }
  replyTo?: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
  messageId?: string
}

export interface DeliverResult {
  messageId: string
  transport: 'smtp' | 'memory'
  response: string
  raw: Buffer | null
}

/** Narrow view of a nodemailer transport, so type churn there cannot break us. */
interface AnyTransporter {
  sendMail(options: SendMailOptions): Promise<unknown>
  verify?(): Promise<unknown>
  close?(): void
}

interface RawInfo {
  messageId?: string
  response?: string
  message?: unknown
}

/**
 * Permanent failures should not be retried: 5xx replies, unknown recipients and
 * malformed envelopes are terminal bounces. Auth/network hiccups are retryable.
 */
export function isPermanentFailure(error: unknown): boolean {
  const err = error as { responseCode?: number; code?: string }
  if (typeof err?.responseCode === 'number' && err.responseCode >= 500) return true
  const code = String(err?.code ?? '')
  return ['EENVELOPE', 'EDNS', 'EAI_BADARGS', 'EMESSAGE', 'ESMTPDATA', 'EFATAL'].includes(code)
}

const formatAddress = (input: { address: string; name?: string }) =>
  input.name ? `"${String(input.name).replace(/["\n\r]/g, '').slice(0, 120)}" <${input.address}>` : input.address

/* ── transport cache (rebuilt whenever SMTP settings change) ─────────────────── */

let cached: { key: string; transporter: AnyTransporter; transport: 'smtp' | 'memory' } | null = null

const cacheKey = (settings: ResolvedSettings): string =>
  [
    settings.transport,
    activeTransport(settings),
    settings.smtp.host,
    settings.smtp.port,
    settings.smtp.secure,
    settings.smtp.user,
    settings.smtp.pool,
    settings.smtp.maxMessages,
  ].join('|')

export function getTransporter(settings = getSettings()) {
  const key = cacheKey(settings)
  if (cached && cached.key === key) return cached
  const transport = activeTransport(settings)
  const options: Record<string, unknown> =
    transport === 'smtp'
      ? {
          host: settings.smtp.host,
          port: settings.smtp.port,
          secure: settings.smtp.secure,
          auth: settings.smtp.user ? { user: settings.smtp.user, pass: settings.smtp.password } : undefined,
          pool: settings.smtp.pool > 1,
          maxConnections: Math.max(1, settings.smtp.pool),
          maxMessages: settings.smtp.maxMessages,
          tls: { minVersion: 'TLSv1.2' },
          requireTLS: settings.smtp.secure,
        }
      : // `streamTransport` renders the complete RFC-822 message without opening a socket
        { streamTransport: true, buffer: true, newline: 'windows' }

  const transporter = nodemailer.createTransport(options as unknown as nodemailer.TransportOptions) as unknown as AnyTransporter
  logger.info(
    transport === 'smtp'
      ? `mailer: SMTP transport ${settings.smtp.host}:${settings.smtp.port} (pool ${settings.smtp.pool})`
      : 'mailer: local mailbox transport (no SMTP configured)',
  )
  cached = { key, transporter, transport }
  return cached
}

export function resetTransporter(): void {
  const previous = cached
  cached = null
  try {
    previous?.transporter.close?.()
  } catch {
    /* ignore */
  }
}

export async function deliver(input: DeliverInput, settings = getSettings()): Promise<DeliverResult> {
  const { transporter, transport } = getTransporter(settings)
  const info = (await transporter.sendMail({
    from: formatAddress(input.from),
    to: formatAddress(input.to),
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    messageId: input.messageId ? `<${input.messageId}>` : undefined,
    headers: input.headers,
    date: new Date(),
  })) as RawInfo

  return {
    messageId: String(info.messageId ?? input.messageId ?? ''),
    transport,
    response: String(info.response ?? (transport === 'memory' ? '250 Queued in local mailbox' : '')),
    raw: Buffer.isBuffer(info.message) ? (info.message as Buffer) : null,
  }
}

export interface VerifyResult {
  ok: boolean
  transport: 'smtp' | 'memory'
  message: string
}

export async function verifyTransport(settings = getSettings()): Promise<VerifyResult> {
  const transport = activeTransport(settings)
  if (transport === 'memory') {
    return {
      ok: true,
      transport,
      message: 'Local mailbox is active — messages are rendered and stored instead of being delivered over SMTP.',
    }
  }
  try {
    const { transporter } = getTransporter(settings)
    await transporter.verify?.()
    return { ok: true, transport, message: `${settings.smtp.host}:${settings.smtp.port} accepted the connection.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, transport, message: `SMTP handshake failed: ${message}` }
  }
}

export async function sendTestMessage(
  args: { to: string; fromName: string; fromEmail: string; subject: string; html: string; text: string; replyTo?: string },
  settings = getSettings(),
): Promise<DeliverResult> {
  return deliver(
    {
      to: { address: args.to },
      from: { address: args.fromEmail, name: args.fromName },
      replyTo: args.replyTo,
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers: { 'X-Mail-Automation-Test': '1' },
    },
    settings,
  )
}
