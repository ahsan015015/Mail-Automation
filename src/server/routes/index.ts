import { Router } from 'express'
import { config } from '../lib/config.js'
import { getDb } from '../db/sqlite.js'
import { requireAuth } from '../middleware.js'
import { authRouter, sessionClaims } from './auth.js'
import { audienceRouter } from './audience.js'
import { campaignRouter } from './campaigns.js'
import { templateRouter } from './templates.js'
import { workspaceRouter } from './workspace.js'
import { getUser, hasUsers } from '../services/auth.js'
import { activeTransport, publicSettings } from '../services/settings.js'

export function apiRouter(): Router {
  const router = Router()

  // unauthenticated
  router.get('/health', (_req, res) => {
    const db = getDb()
    res.json({
      ok: true,
      service: 'mail-automation',
      version: '1.0.0',
      env: config.env,
      transport: activeTransport(),
      uptimeSeconds: Math.round(process.uptime()),
      database: db.stats(),
      at: new Date().toISOString(),
    })
  })

  router.use('/auth', authRouter())

  /**
   * The SPA calls this before it knows whether a session exists, so it must stay
   * public: without a cookie it reports who is missing (needsSetup) and nothing else.
   */
  router.get('/bootstrap', (req, res) => {
    const claims = sessionClaims(req)
    const user = claims ? getUser(claims.uid) : null
    res.json({
      user: user ?? null,
      needsSetup: !hasUsers(),
      settings: user ? publicSettings() : undefined,
      app: { name: 'Mail Automation', version: '1.0.0', env: config.env },
    })
  })

  // everything below needs a session
  router.use(requireAuth)

  router.use(audienceRouter())
  router.use(templateRouter())
  router.use(campaignRouter())
  router.use(workspaceRouter())

  return router
}
