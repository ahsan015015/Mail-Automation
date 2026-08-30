import fs from 'node:fs'
import path from 'node:path'
import express, { type Express } from 'express'
import { errorHandler, notFound } from './middleware.js'
import { apiRouter } from './routes/index.js'
import { publicRouter, trackingRouter } from './routes/tracking.js'
import { rememberOrigin } from './lib/public-origin.js'
import { logger } from './lib/log.js'
import { config } from './lib/config.js'

const CLIENT_DIR = path.resolve('dist/client')

export interface CreateAppOptions {
  /** Serve the built SPA from `dist/client` when it exists. */
  serveStatic?: boolean
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(express.json({ limit: '6mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  app.use((req, _res, next) => {
    rememberOrigin(req)
    next()
  })

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Framing is opt-in. Session cookies are SameSite=Lax, so a foreign frame cannot make
    // state-changing calls even when FRAME_ANCESTORS opens the UI up to an embedded preview.
    if (config.frameAncestors !== '*') {
      res.setHeader('X-Frame-Options', config.frameAncestors === "'self'" ? 'SAMEORIGIN' : 'DENY')
      res.setHeader('Content-Security-Policy', `frame-ancestors ${config.frameAncestors}`)
    }
    next()
  })

  // API payloads must never come from a cache: the SPA refetches after every
  // mutation and a heuristic cache would show stale campaign or contact data.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  // request log (dev only, keeps test output clean)
  if (!config.isTest) {
    app.use((req, res, next) => {
      const started = Date.now()
      res.on('finish', () => {
        if (req.originalUrl.startsWith('/api/stream') || req.originalUrl.startsWith('/t/o/')) return
        logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`)
      })
      next()
    })
  }

  // recipient-facing endpoints (no session: they are clicked from an email)
  app.use('/t', trackingRouter())
  app.use('/public', publicRouter())

  app.use('/api', apiRouter())
  app.use('/api', (_req, res) => {
    notFound(_req, res)
  })

  const serveStatic = options.serveStatic ?? true
  if (serveStatic && fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
    app.use(express.static(CLIENT_DIR, { index: false, maxAge: config.isProd ? '30d' : 0 }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/t') || req.path.startsWith('/public')) return next()
      const file = path.join(CLIENT_DIR, req.path)
      if (path.extname(file)) return next() // missing asset → 404 rather than index.html
      res.setHeader('Cache-Control', 'no-cache')
      res.type('html').send(fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8'))
    })
  } else if (serveStatic && !config.isProd) {
    app.get('/', (_req, res) => {
      res
        .type('html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>Mail Automation</title>
           <body style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f5f9">
           <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 32px;max-width:520px">
           <h1 style="margin:0 0 8px;font-size:20px">API is running — no UI build yet</h1>
           <p style="margin:0 0 14px;color:#475569">Run <code>npm run dev</code> for the Vite dev server, or <code>npm run build &amp;&amp; npm start</code> to serve the dashboard from this port.</p>
           <p style="margin:0"><a style="color:#4f46e5" href="/api/health">/api/health</a> · <a style="color:#4f46e5" href="/api/bootstrap">/api/bootstrap</a></p>
           </div></body>`,
        )
    })
  }

  app.use(notFound)
  app.use(errorHandler)
  return app
}
