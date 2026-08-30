import { config } from '../lib/config.js'
import { getDb } from '../db/sqlite.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { normalizeEmail } from '../lib/http.js'
import { badRequest, nowIso, unauthorized } from '../lib/util.js'
import type { UserDto } from '../../shared/types.js'

interface UserRow {
  id: number
  email: string
  name: string
  role: 'owner' | 'member'
  created_at: string
  password_hash?: string
}

const map = (row: UserRow): UserDto => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  createdAt: row.created_at,
})

export function hasUsers(): boolean {
  return getDb().count('SELECT COUNT(*) FROM users') > 0
}

export function createUser(input: { email: string; name?: string; password: string; role?: 'owner' | 'member' }): UserDto {
  const email = normalizeEmail(input.email)
  const existing = getDb().get<{ id: number }>('SELECT id FROM users WHERE email = ?', email)
  if (existing) throw badRequest('That email already has an account')
  const result = getDb().run(
    'INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    email,
    (input.name ?? '').trim(),
    hashPassword(input.password),
    input.role ?? (hasUsers() ? 'member' : 'owner'),
    nowIso(),
  )
  return getUser(result.lastInsertRowid)!
}

export function getUser(id: number): UserDto | null {
  const row = getDb().get<UserRow>('SELECT id, email, name, role, created_at FROM users WHERE id = ?', id)
  return row ? map(row) : null
}

export function authenticate(email: string, password: string): UserDto {
  const row = getDb().get<UserRow & { password_hash: string }>(
    'SELECT id, email, name, role, created_at, password_hash FROM users WHERE email = ?',
    normalizeEmail(email),
  )
  if (!row || !verifyPassword(password, row.password_hash)) throw unauthorized('Email or password is incorrect')
  getDb().run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), row.id)
  return map(row)
}

export function changePassword(userId: number, password: string): void {
  getDb().run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId)
}

/**
 * On a brand-new install, create the admin from env so `npm run serve` is
 * immediately usable. No-op as soon as any user exists.
 */
export function ensureBootstrapAdmin(): UserDto | null {
  if (hasUsers()) return null
  const user = createUser({
    email: config.bootstrapAdmin.email,
    name: 'Workspace owner',
    password: config.bootstrapAdmin.password,
    role: 'owner',
  })
  return user
}
