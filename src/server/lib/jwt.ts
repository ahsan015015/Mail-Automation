import crypto from 'node:crypto'
import { config } from './config.js'

const b64u = (input: Buffer | string) => Buffer.from(input).toString('base64url')

export interface SessionClaims {
  uid: number
  email: string
  /** seconds since epoch */
  iat: number
  exp: number
}

export function signSession(claims: Omit<SessionClaims, 'iat' | 'exp'>, ttlSeconds = config.sessionTtlHours * 3600): string {
  const now = Math.floor(Date.now() / 1000)
  const body: SessionClaims = { ...claims, iat: now, exp: now + ttlSeconds }
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(JSON.stringify(body))
  return `${head}.${payload}.${hmac(`${head}.${payload}`)}`
}

export function verifySession(token: string | undefined | null): SessionClaims | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, payload, sig] = parts as [string, string, string]
  const expected = Buffer.from(hmac(`${head}.${payload}`))
  const provided = Buffer.from(sig)
  // timingSafeEqual throws on length mismatch, and tokens arrive straight from browsers
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
    return claims
  } catch {
    return null
  }
}

function hmac(data: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url')
}
