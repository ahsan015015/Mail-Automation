import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Boots a throwaway workspace: temp SQLite file, temp mail dir, the real
 * Express app on an ephemeral port. The engine is driven manually
 * (`engine.tick`) so tests never depend on wall-clock timers.
 */
export interface Workspace {
  base: string
  dir: string
  db: DbHandle
  api: (path: string, init?: RequestInit & { auth?: boolean }) => Promise<{ status: number; body: any; headers: Headers }>
  login: (email: string, password: string) => Promise<void>
  cookie: () => string
  close: () => Promise<void>
}

type DbHandle = ReturnType<typeof import('../src/server/db/sqlite.js').openDatabase>

const instances: Workspace[] = []

export async function bootWorkspace(seed = false): Promise<Workspace> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-automation-test-'))
  process.env.NODE_ENV = 'test'
  process.env.DB_PATH = path.join(dir, 'test.db')
  process.env.MAIL_DIR = path.join(dir, 'mail')
  process.env.SESSION_SECRET = 'test-session-secret-not-for-production'
  process.env.TRACKING_SECRET = 'test-tracking-secret'
  process.env.PUBLIC_BASE_URL = ''
  process.env.ADMIN_EMAIL = 'admin@test.dev'
  process.env.ADMIN_PASSWORD = 'test-password-123'
  process.env.SEED_DEMO = seed ? '1' : '0'
  process.env.SEND_TICK_MS = '60'

  const { openDatabase, useDatabase } = await import('../src/server/db/sqlite.js')
  const db = openDatabase(process.env.DB_PATH)
  useDatabase(db)

  const { engine } = await import('../src/server/services/engine.js')
  const { resetTransporter } = await import('../src/server/services/mailer.js')
  const { createApp } = await import('../src/server/app.js')

  resetTransporter()
  const app = createApp({ serveStatic: false })
  const server: Server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.PUBLIC_BASE_URL = base

  let cookie = ''
  const workspace: Workspace = {
    base,
    dir,
    db,
    cookie: () => cookie,
    async login(email, password) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!response.ok) throw new Error(`login failed: ${response.status}`)
      const setCookie = response.headers.get('set-cookie') ?? ''
      cookie = setCookie.split(';')[0] ?? ''
    },
    async api(route, init = {}) {
      const headers = new Headers(init.headers)
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
      if (cookie) headers.set('Cookie', cookie)
      const response = await fetch(`${base}${route}`, { ...init, headers, redirect: 'manual' })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = (setCookie.split(';')[0] ?? '').trim()
      const text = await response.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        /* html or empty */
      }
      return { status: response.status, body, headers: response.headers }
    },
    async close() {
      engine.stop()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try {
        useDatabase(null)
        db.close()
      } catch {
        /* already closed */
      }
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 })
    },
  }
  instances.push(workspace)
  return workspace
}

afterAll(async () => {
  while (instances.length) await instances.pop()?.close()
})

/** Every send is rendered by the memory transport, so nothing touches port 25. */
export interface DrainResult {
  processed: number
  sent: number
  failed: number
  skipped: number
  activated: number
  completed: number
}

export async function drainQueue(options: { maxRounds?: number } = {}): Promise<DrainResult> {
  const { engine } = await import('../src/server/services/engine.js')
  return (await engine.drain({ maxRounds: options.maxRounds ?? 200, ignoreLimits: true })) as DrainResult
}

export async function resetTables(): Promise<void> {
  const { getDb } = await import('../src/server/db/sqlite.js')
  const db = getDb()
  db.exec('PRAGMA foreign_keys = OFF')
  for (const table of ['sends', 'steps', 'campaigns', 'events', 'mailbox', 'templates', 'contact_tags', 'contact_lists', 'contacts', 'tags', 'lists', 'settings', 'users']) {
    db.run(`DELETE FROM ${table}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
}

export const uniqueSuffix = (): string => Math.random().toString(36).slice(2, 8)

/** Silence the "unhandled" noise from aborted SSE requests in CI logs. */
beforeEach(() => {
  process.env.TZ = 'UTC'
})
