import { config } from './lib/config.js'
import { logger } from './lib/log.js'
import { getDb } from './db/sqlite.js'
import { createApp } from './app.js'
import { ensureBootstrapAdmin } from './services/auth.js'
import { engine } from './services/engine.js'
import { seedDemoData } from './db/seed.js'
import { activeTransport } from './services/settings.js'
import { publicOrigin } from './lib/public-origin.js'

function banner(port: number): void {
  const transport = activeTransport()
  const lines = [
    '',
    `  Mail Automation  ·  env ${config.env}`,
    `  ├─ app       http://127.0.0.1:${port}`,
    `  ├─ api       http://127.0.0.1:${port}/api/health`,
    `  ├─ origin    ${publicOrigin()}`,
    `  ├─ database  ${config.dbPath}`,
    `  ├─ transport ${transport === 'smtp' ? `SMTP ${config.smtp.host}:${config.smtp.port}` : 'local mailbox (var/mail + Inbox page)'}`,
    `  └─ links     ${config.publicBaseUrl ? 'PUBLIC_BASE_URL' : 'derived per request'}`,
    '',
  ]
  for (const line of lines) logger.info(line)
}

function boot(): void {
  const db = getDb()
  logger.info(`db ready: ${db.stats().file} (${db.stats().tables} tables, ${db.stats().sizeBytes} bytes)`)

  if (config.isProd && config.sessionSecret.startsWith('dev-only')) {
    logger.warn('SESSION_SECRET is the built-in default — set a real secret before exposing this instance')
  }

  const admin = ensureBootstrapAdmin()
  if (admin) logger.info(`created first admin: ${admin.email} (sign in, then change the password)`)

  if (config.seedDemo) {
    const result = seedDemoData()
    if (!result.skipped) logger.info(`demo workspace seeded: ${result.contacts} contacts, ${result.templates} templates, ${result.campaigns} campaigns`)
  }

  const app = createApp()
  const server = app.listen(config.port, config.host, () => banner(config.port))
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') logger.error(`port ${config.port} is busy — set PORT to something else`)
    else logger.error(error)
    process.exit(1)
  })

  engine.start()

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`${signal} received — draining in-flight sends`)
    engine.stop()
    server.close(() => {
      try {
        db.close()
      } catch {
        /* already closed */
      }
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason instanceof Error ? reason : String(reason)))
}

boot()
