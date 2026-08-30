import { getDb } from '../db/sqlite.js'
import { nowIso } from '../lib/util.js'
import { conflict, notFound } from '../lib/util.js'
import { randomToken } from '../lib/tokens.js'
import type { ListDto, TagDto } from '../../shared/types.js'

interface ListRow {
  id: number
  name: string
  description: string
  subscribe_token: string
  archived: number
  created_at: string
  contact_count?: number
  subscribed_count?: number
  unsubscribe_count?: number
}

const mapList = (row: ListRow): ListDto => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  archived: Boolean(row.archived),
  subscribeToken: row.subscribe_token ?? '',
  contactCount: Number(row.contact_count ?? 0),
  subscribedCount: Number(row.subscribed_count ?? 0),
  unsubscribeCount: Number(row.unsubscribe_count ?? 0),
  createdAt: row.created_at,
})

const LIST_SELECT = `
  SELECT l.*,
         (SELECT COUNT(*) FROM contact_lists cl WHERE cl.list_id = l.id) AS contact_count,
         (SELECT COUNT(*) FROM contact_lists cl JOIN contacts c ON c.id = cl.contact_id
           WHERE cl.list_id = l.id AND c.status = 'subscribed') AS subscribed_count,
         (SELECT COUNT(*) FROM contact_lists cl JOIN contacts c ON c.id = cl.contact_id
           WHERE cl.list_id = l.id AND c.status IN ('unsubscribed','bounced','complained')) AS unsubscribe_count
  FROM lists l`

export function listLists(opts: { includeArchived?: boolean; search?: string } = {}): ListDto[] {
  const where: string[] = []
  const params: unknown[] = []
  if (!opts.includeArchived) where.push('l.archived = 0')
  if (opts.search) {
    where.push('LOWER(l.name) LIKE ?')
    params.push(`%${opts.search.toLowerCase()}%`)
  }
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.name COLLATE NOCASE`
  return getDb().all<ListRow>(sql, ...params).map(mapList)
}

export function getList(id: number): ListDto {
  const row = getDb().get<ListRow>(`${LIST_SELECT} WHERE l.id = ?`, id)
  if (!row) throw notFound('List not found')
  return mapList(row)
}

export function getListByToken(token: string): ListDto | null {
  const row = getDb().get<ListRow>(`${LIST_SELECT} WHERE l.subscribe_token = ?`, token)
  return row ? mapList(row) : null
}

export function findListByName(name: string): ListDto | null {
  const row = getDb().get<ListRow>(`${LIST_SELECT} WHERE l.name = ?`, name)
  return row ? mapList(row) : null
}

export function createList(input: { name: string; description?: string; archived?: boolean }): ListDto {
  const name = input.name.trim()
  if (findListByName(name)) throw conflict(`A list called “${name}” already exists`)
  const now = nowIso()
  const result = getDb().run(
    'INSERT INTO lists (name, description, subscribe_token, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    name,
    (input.description ?? '').trim(),
    randomToken(12),
    Boolean(input.archived),
    now,
    now,
  )
  return getList(result.lastInsertRowid)
}

export function updateList(id: number, patch: Partial<{ name: string; description: string; archived: boolean }>): ListDto {
  const current = getList(id)
  const name = patch.name?.trim() || current.name
  if (name !== current.name && findListByName(name)) throw conflict(`A list called “${name}” already exists`)
  const description = patch.description ?? current.description
  const archived = patch.archived ?? current.archived
  getDb().run('UPDATE lists SET name = ?, description = ?, archived = ?, updated_at = ? WHERE id = ?', name, description, Boolean(archived), nowIso(), id)
  return getList(id)
}

export function deleteList(id: number): void {
  getList(id)
  getDb().run('DELETE FROM lists WHERE id = ?', id)
}

export function regenerateSubscribeToken(id: number): ListDto {
  getList(id)
  getDb().run('UPDATE lists SET subscribe_token = ?, updated_at = ? WHERE id = ?', randomToken(12), nowIso(), id)
  return getList(id)
}

/* ── tags ──────────────────────────────────────────────────────────────────── */

interface TagRow {
  id: number
  name: string
  color: string
  contact_count?: number
}

const mapTag = (row: TagRow): TagDto => ({ id: row.id, name: row.name, color: row.color, contactCount: Number(row.contact_count ?? 0) })

export function listTags(): TagDto[] {
  return getDb()
    .all<TagRow>(
      `SELECT t.*, (SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id = t.id) AS contact_count
       FROM tags t ORDER BY t.name COLLATE NOCASE`,
    )
    .map(mapTag)
}

export function getOrCreateTag(name: string, color = '#6366f1'): TagDto {
  const clean = name.trim().replace(/^#/, '')
  const existing = getDb().get<TagRow>(`SELECT * FROM tags WHERE name = ? COLLATE NOCASE`, clean)
  if (existing) return mapTag(existing)
  const result = getDb().run('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)', clean, color, nowIso())
  return mapTag(getDb().get<TagRow>('SELECT * FROM tags WHERE id = ?', result.lastInsertRowid)!)
}

export function createTag(name: string, color?: string): TagDto {
  const clean = name.trim().replace(/^#/, '')
  if (getDb().get<{ id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', clean)) {
    throw conflict(`Tag “${clean}” already exists`)
  }
  const result = getDb().run('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)', clean, color ?? '#6366f1', nowIso())
  return mapTag(getDb().get<TagRow>('SELECT * FROM tags WHERE id = ?', result.lastInsertRowid)!)
}

export function deleteTag(id: number): void {
  const removed = getDb().run('DELETE FROM tags WHERE id = ?', id).changes
  if (!removed) throw notFound('Tag not found')
}

/** Resolve a list of tag names to ids, creating missing tags on the fly. */
export function resolveTagIds(names: string[], palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']): number[] {
  const out: number[] = []
  names.forEach((name, index) => {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) return
    const tag = getOrCreateTag(trimmed, palette[index % palette.length]!)
    if (!out.includes(tag.id)) out.push(tag.id)
  })
  return out
}
