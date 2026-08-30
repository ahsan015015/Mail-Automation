import crypto from 'node:crypto'
import { config } from './config.js'

/**
 * Short, tamper-evident tokens embedded in every tracked link:
 *   /t/o/<token>  open pixel        /t/c/<token>?u=<url>  click redirect
 *   /t/u/<token>  unsubscribe       /t/p/<token>          preference centre
 *
 * The token is `base64url(json payload).hmac`; no database round trip is needed
 * to validate it and it never leaks a raw numeric id.
 */
export type TokenKind = 'o' | 'c' | 'u' | 'p'

export interface TokenPayload {
  k: TokenKind
  /** send id (open/click) or contact id (unsub/preferences) */
  i: number
  /** optional campaign id, used for stats that are aggregated per campaign */
  cid?: number
}

export function signToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

export function readToken(token: string | undefined | null): TokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = hmac(body)
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (typeof parsed.i !== 'number' || !['o', 'c', 'u', 'p'].includes(parsed.k)) return null
    return parsed
  } catch {
    return null
  }
}

function hmac(data: string): string {
  return crypto.createHmac('sha256', config.trackingSecret).update(data).digest('base64url')
}

/** opaque, unguessable token for public list subscribe endpoints */
export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
