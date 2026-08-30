import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import { logger } from './lib/log.js'
import { HttpError, unauthorized } from './lib/util.js'
import { getUser } from './services/auth.js'
import { sessionClaims } from './routes/auth.js'

/** Async handlers do not need try/catch: rejections are forwarded to the error handler. */
export const wrap =
  (handler: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next)
  }

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const claims = sessionClaims(req)
  if (!claims) throw unauthorized()
  const user = getUser(claims.uid)
  if (!user) throw unauthorized('Session expired — sign in again')
  req.user = user
  next()
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.originalUrl}`, status: 404 } })
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.map((part) => String(part)).join('.'), message: issue.message }))
    res.status(422).json({ error: { message: issues[0]?.message ?? 'Invalid request', issues } })
    return
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { message: error.message, issues: error.details } })
    return
  }
  const anyError = error as { status?: number; details?: unknown; message?: string; code?: string }
  if (anyError?.status === 422 && anyError.details) {
    res.status(422).json({ error: { message: anyError.message, issues: anyError.details } })
    return
  }
  if (anyError?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    res.status(409).json({ error: { message: 'That value is already taken' } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`${req.method} ${req.originalUrl} → ${message}`)
  res.status(500).json({ error: { message: safeMessage(message) } })
}

/** Never leak stack traces or filesystem paths through the API. */
function safeMessage(message: string): string {
  const trimmed = String(message || '').slice(0, 300)
  return trimmed || 'Unexpected server error'
}
