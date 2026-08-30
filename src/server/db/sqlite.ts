import '../lib/quiet-sqlite-warning.js'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../lib/config.js'
import { MIGRATIONS } from './schema.js'

export type SqlValue = string | number | bigint | null | Uint8Array
export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/**
 * Thin, synchronous wrapper around `node:sqlite` with parameter coercion so the
 * rest of the codebase can pass booleans, dates and plain objects directly.
 */
export class Database {
  readonly file: string
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.file = file
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = NORMAL')
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return (this.db.prepare(sql).all(...bind(params)) as Record<string, unknown>[]).map((row) => ({ ...row }) as T)
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null {
    const row = this.db.prepare(sql).get(...bind(params)) as Record<string, unknown> | undefined
    return row ? ({ ...row } as T) : null
  }

  run(sql: string, ...params: unknown[]): RunResult {
    const result = this.db.prepare(sql).run(...bind(params))
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  pluck<T>(sql: string, ...params: unknown[]): T | null {
    const row = this.get<Record<string, unknown>>(sql, ...params)
    if (!row) return null
    return Object.values(row)[0] as T
  }

  count(sql: string, ...params: unknown[]): number {
    return Number(this.pluck<unknown>(sql, ...params) ?? 0)
  }

  private txDepth = 0

  /**
   * Re-entrant: nested calls join the outermost transaction (single connection,
   * synchronous API), so services can freely compose transactional helpers.
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth += 1
      try {
        return fn()
      } finally {
        this.txDepth -= 1
      }
    }
    this.db.exec('BEGIN IMMEDIATE')
    this.txDepth = 1
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* the transaction was already unwound */
      }
      throw error
    } finally {
      this.txDepth = 0
    }
  }

  userVersion(): number {
    return Number(this.pluck<unknown>('PRAGMA user_version') ?? 0)
  }

  stats(): { file: string; tables: number; sizeBytes: number } {
    const tables = this.count(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    let sizeBytes = 0
    try {
      if (this.file !== ':memory:') sizeBytes = fs.statSync(this.file).size
    } catch {
      sizeBytes = 0
    }
    return { file: this.file, tables, sizeBytes }
  }

  close(): void {
    this.db.close()
  }
}

function bind(params: unknown[]): SqlValue[] {
  return params.map((value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value
    if (value instanceof Date) return value.toISOString()
    if (ArrayBuffer.isView(value)) return value as Uint8Array
    return JSON.stringify(value)
  })
}

/* ── singleton wiring ──────────────────────────────────────────────────────── */

let current: Database | null = null

export function openDatabase(file: string): Database {
  const db = new Database(file)
  migrate(db)
  return db
}

/** Lazily open (and migrate) the database pointed at by `DB_PATH`. */
export function getDb(): Database {
  if (!current) current = openDatabase(config.dbPath)
  return current
}

/** Install a specific connection — used by tests and the seed script. */
export function useDatabase(db: Database | null): Database | null {
  if (current && current !== db) current.close()
  const previous = current
  current = db
  return previous
}

export function migrate(db: Database): number {
  const from = db.userVersion()
  for (let i = from; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!)
      db.exec(`PRAGMA user_version = ${i + 1}`)
    })
  }
  return MIGRATIONS.length
}
