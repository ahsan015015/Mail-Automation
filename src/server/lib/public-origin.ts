import type { Request } from 'express'
import { config } from './config.js'

/**
 * Absolute origin used when building tracking links from contexts that have no
 * HTTP request (the sending engine). It prefers an explicit PUBLIC_BASE_URL,
 * then the most recent origin the app was actually reached on (handy behind a
 * tunnel/preview proxy), then the local port.
 */
let seen: string | null = null

export function rememberOrigin(req: Request): void {
  const host = req.get('x-forwarded-host') || req.get('host')
  if (!host) return
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http'
  const origin = `${proto}://${host}`.replace(/\/+$/, '')
  if (origin !== seen) seen = origin
}

export function publicOrigin(): string {
  if (config.publicBaseUrl) return config.publicBaseUrl
  return seen || `http://127.0.0.1:${config.port}`
}

/** test seam */
export function setPublicOrigin(origin: string | null): void {
  seen = origin
}
