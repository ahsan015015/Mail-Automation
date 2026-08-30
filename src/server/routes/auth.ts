import { Router, type Request } from 'express'
import { config } from '../lib/config.js'
import { clearCookie, parseCookies, serializeCookie } from '../lib/http.js'
import { signSession, verifySession } from '../lib/jwt.js'
import { logger } from '../lib/log.js'
import { badRequest, HttpError, nowIso } from '../lib/util.js'
import { authenticate, createUser, ensureBootstrapAdmin, getUser, hasUsers } from '../services/auth.js'
import { getSettings } from '../services/settings.js'
import { loginSchema, parseOr, setupSchema } from '../lib/validation.js'

const COOKIE = 'ma_session'

export function sessionClaims(req: Request): ReturnType<typeof verifySession> {
  const cookies = (req.cookies as Record<string, string> | undefined) ?? parseCookies(String(req.headers.cookie ?? ''))
  return verifySession(cookies[COOKIE])
}

/* very small in-memory throttle for the credential endpoints */
const attempts = new Map<string, { count: number; resetAt: number }>()
function throttle(key: string, max = 10, windowMs = 60_000): void {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count += 1
  if (entry.count > max) throw new HttpError(429, 'Too many attempts — wait a minute and try again')
}

export function sessionCookie(value: string, maxAgeSeconds = config.sessionTtlHours * 3600): string {
  return serializeCookie(COOKIE, value, { maxAgeSeconds })
}

export function authRouter(): Router {
  const router = Router()

  router.post('/login', (req, res) => {
    const input = parseOr(loginSchema, req.body)
    throttle(`login:${req.ip}:${input.email}`)
    ensureBootstrapAdmin()
    const user = authenticate(input.email, input.password)
    res.setHeader('Set-Cookie', sessionCookie(signSession({ uid: user.id, email: user.email })))
    res.json({ user, csrfOk: true })
  })

  router.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearCookie(COOKIE))
    res.json({ ok: true })
  })

  router.get('/me', (req, res) => {
    const claims = sessionClaims(req)
    const user = claims ? getUser(claims.uid) : null
    res.json({
      user,
      needsSetup: !hasUsers(),
      workspaceName: getSettings().workspaceName,
      demoMode: !getSettings().smtp.host,
    })
  })

  /** Only usable while the users table is empty (first run). */
  router.post('/setup', (req, res) => {
    if (hasUsers()) throw badRequest('This workspace already has users — sign in instead')
    const input = parseOr(setupSchema, req.body)
    const user = createUser({ email: input.email, name: input.name || 'Workspace owner', password: input.password, role: 'owner' })
    logger.info(`auth: created first user ${user.email}`)
    res.setHeader('Set-Cookie', sessionCookie(signSession({ uid: user.id, email: user.email })))
    res.status(201).json({ user, at: nowIso() })
  })

  return router
}

export { COOKIE }
