import crypto from 'node:crypto'
import type { Request } from 'express'
import { config } from './config.js'

/* ── cookies ─────────────────────────────────────────────────────────────── */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none' } = {},
): string {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${Math.floor(opts.maxAgeSeconds ?? 0)}`]
  if (opts.httpOnly !== false) bits.push('HttpOnly')
  if (opts.secure ?? config.isProd) bits.push('Secure')
  const sameSiteMap: Record<string, string> = { lax: 'Lax', strict: 'Strict', none: 'None' }
  const sameSite = opts.sameSite ? sameSiteMap[opts.sameSite] ?? opts.sameSite : 'Lax'
  bits.push(`SameSite=${sameSite}`)
  return bits.join('; ')
}

export function clearCookie(
  name: string,
  opts: { secure?: boolean; sameSite?: 'lax' | 'strict' | 'none' } = {},
): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, ...opts })
}

/* ── request helpers ─────────────────────────────────────────────────────── */

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim()
  return req.socket?.remoteAddress ?? ''
}

/**
 * Absolute base URL used when building links that must be reachable from an
 * email client (pixels, click redirects, unsubscribe pages).
 */
export function baseUrl(req: Request): string {
  if (config.publicBaseUrl) return config.publicBaseUrl
  const proto = firstHeader(req, 'x-forwarded-proto') || req.protocol || 'http'
  const host = firstHeader(req, 'x-forwarded-host') || req.get('host') || `localhost:${config.port}`
  return `${proto}://${host}`
}

function firstHeader(req: Request, name: string): string {
  const value = req.headers[name]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/* ── misc ────────────────────────────────────────────────────────────────── */

export function randomHex(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i

export function normalizeEmail(input: string): string {
  return String(input || '').trim().toLowerCase()
}

export function isValidEmail(input: string): boolean {
  const email = normalizeEmail(input)
  return email.length <= 254 && EMAIL_RE.test(email)
}

export function splitName(full: string): { first: string; last: string } {
  const parts = String(full || '').trim().split(/\s+/)
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' }
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}
