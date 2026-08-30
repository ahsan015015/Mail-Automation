import { getDb } from '../db/sqlite.js'
import { normalizeEmail } from '../lib/http.js'
import { csvToContacts, toCsv } from '../lib/csv.js'
import { badRequest, conflict, jsonParse, nowIso, notFound, uniqueBy } from '../lib/util.js'
import { getOrCreateTag, listTags } from './lists.js'
import type { ContactDto, ContactStatus, ListDto, Paged, Segment, TagDto } from '../../shared/types.js'

interface ContactRow {
  id: number
  email: string
  name: string
  fields: string
  status: ContactStatus
  unsubscribed_at: string | null
  created_at: string
  updated_at: string
  sent_count?: number
  open_count?: number
  click_count?: number
  last_open_at?: string | null
  last_click_at?: string | null
}

type ListMini = Pick<ListDto, 'id' | 'name'>

const BASE_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM sends s WHERE s.contact_id = c.id AND s.status IN ('sent','bounced')) AS sent_count,
         (SELECT COUNT(*) FROM sends s WHERE s.contact_id = c.id AND s.open_count > 0) AS open_count,
         (SELECT COUNT(*) FROM sends s WHERE s.contact_id = c.id AND s.click_count > 0) AS click_count,
         (SELECT MAX(s.opened_at) FROM sends s WHERE s.contact_id = c.id) AS last_open_at,
         (SELECT MAX(s.clicked_at) FROM sends s WHERE s.contact_id = c.id) AS last_click_at
  FROM contacts c`

const SORTS: Record<string, string> = {
  created_desc: 'c.created_at DESC, c.id DESC',
  created_asc: 'c.created_at ASC, c.id ASC',
  email_asc: 'c.email COLLATE NOCASE ASC',
  email_desc: 'c.email COLLATE NOCASE DESC',
  opened_desc: 'last_open_at DESC, c.id DESC',
}

export interface ContactFilter {
  q?: string
  listId?: number
  tagId?: number
  status?: ContactStatus | 'all'
  sort?: string
  page?: number
  perPage?: number
}

export function listContacts(filter: ContactFilter = {}): Paged<ContactDto> {
  const page = Math.max(1, Number(filter.page ?? 1) || 1)
  const perPage = Math.min(200, Math.max(5, Number(filter.perPage ?? 25) || 25))
  const { where, params } = buildWhere(filter)
  const order = SORTS[String(filter.sort ?? 'created_desc')] ?? SORTS.created_desc!

  const total = getDb().count(`SELECT COUNT(*) FROM contacts c ${where}`, ...params)
  const rows = getDb().all<ContactRow>(
    `${BASE_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage,
  )
  return { items: hydrate(rows), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

function buildWhere(filter: ContactFilter): { where: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  const q = (filter.q ?? '').trim().toLowerCase()
  if (q) {
    clauses.push('(INSTR(LOWER(c.email), ?) > 0 OR INSTR(LOWER(c.name), ?) > 0 OR INSTR(LOWER(c.fields), ?) > 0)')
    params.push(q, q, q)
  }
  if (filter.listId) {
    clauses.push('EXISTS (SELECT 1 FROM contact_lists cl WHERE cl.contact_id = c.id AND cl.list_id = ?)')
    params.push(filter.listId)
  }
  if (filter.tagId) {
    clauses.push('EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ?)')
    params.push(filter.tagId)
  }
  if (filter.status && filter.status !== 'all') {
    clauses.push('c.status = ?')
    params.push(filter.status)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

/** Attach lists + tags for a page of contacts without N+1 queries. */
function hydrate(rows: ContactRow[]): ContactDto[] {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(',')
  const listRows = getDb().all<{ contact_id: number; id: number; name: string }>(
    `SELECT cl.contact_id, l.id, l.name FROM contact_lists cl JOIN lists l ON l.id = cl.list_id
     WHERE cl.contact_id IN (${placeholders}) ORDER BY l.name COLLATE NOCASE`,
    ...ids,
  )
  const tagRows = getDb().all<{ contact_id: number; id: number; name: string; color: string }>(
    `SELECT ct.contact_id, t.id, t.name, t.color FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.contact_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`,
    ...ids,
  )
  const listsByContact = new Map<number, ListMini[]>()
  for (const row of listRows) {
    const bucket = listsByContact.get(row.contact_id) ?? []
    bucket.push({ id: row.id, name: row.name })
    listsByContact.set(row.contact_id, bucket)
  }
  const tagsByContact = new Map<number, TagDto[]>()
  for (const row of tagRows) {
    const bucket = tagsByContact.get(row.contact_id) ?? []
    bucket.push({ id: row.id, name: row.name, color: row.color, contactCount: 0 })
    tagsByContact.set(row.contact_id, bucket)
  }
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name ?? '',
    fields: jsonParse<Record<string, string>>(row.fields, {}),
    status: row.status,
    tags: tagsByContact.get(row.id) ?? [],
    lists: listsByContact.get(row.id) ?? [],
    sentCount: Number(row.sent_count ?? 0),
    openCount: Number(row.open_count ?? 0),
    clickCount: Number(row.click_count ?? 0),
    lastOpenAt: row.last_open_at ?? null,
    lastClickAt: row.last_click_at ?? null,
    unsubscribedAt: row.unsubscribed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function getContact(id: number): ContactDto {
  const row = getDb().get<ContactRow>(`${BASE_SELECT} WHERE c.id = ?`, id)
  if (!row) throw notFound('Contact not found')
  return hydrate([row])[0]!
}

export function findContactByEmail(email: string): ContactDto | null {
  const row = getDb().get<ContactRow>(`${BASE_SELECT} WHERE c.email = ?`, normalizeEmail(email))
  return row ? hydrate([row])[0]! : null
}

export function contactIdFor(email: string): number | null {
  return getDb().get<{ id: number }>('SELECT id FROM contacts WHERE email = ?', normalizeEmail(email))?.id ?? null
}

/* ── writes ────────────────────────────────────────────────────────────────── */

export function createContact(input: {
  email: string
  name?: string
  fields?: Record<string, string>
  status?: ContactStatus
  listIds?: number[]
  tags?: string[]
}): ContactDto {
  const email = normalizeEmail(input.email)
  if (getDb().get<{ id: number }>('SELECT id FROM contacts WHERE email = ?', email)) {
    throw conflict(`${email} is already in your audience`)
  }
  const now = nowIso()
  const status = input.status ?? 'subscribed'
  const result = getDb().run(
    'INSERT INTO contacts (email, name, fields, status, unsubscribed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    email,
    (input.name ?? '').trim(),
    jsonParse(input.fields, {}),
    status,
    status === 'subscribed' ? null : now,
    now,
    now,
  )
  const id = result.lastInsertRowid
  if (input.listIds?.length) setLists(id, input.listIds)
  if (input.tags?.length) setTags(id, input.tags)
  return getContact(id)
}

export function updateContact(
  id: number,
  patch: Partial<{ email: string; name: string; fields: Record<string, string>; status: ContactStatus; listIds: number[]; tags: string[] }>,
): ContactDto {
  const current = getDb().get<ContactRow>('SELECT * FROM contacts WHERE id = ?', id)
  if (!current) throw notFound('Contact not found')

  const email = patch.email ? normalizeEmail(patch.email) : current.email
  if (email !== current.email && getDb().get<{ id: number }>('SELECT id FROM contacts WHERE email = ? AND id <> ?', email, id)) {
    throw conflict('Another contact already uses that email')
  }
  const status = patch.status ?? current.status
  const fields = patch.fields ?? jsonParse<Record<string, string>>(current.fields, {})
  const unsubscribedAt = status === 'subscribed' ? null : status === 'unsubscribed' && !current.unsubscribed_at ? nowIso() : current.unsubscribed_at
  getDb().run(
    'UPDATE contacts SET email = ?, name = ?, fields = ?, status = ?, unsubscribed_at = ?, updated_at = ? WHERE id = ?',
    email,
    patch.name ?? current.name,
    fields,
    status,
    unsubscribedAt,
    nowIso(),
    id,
  )
  if (patch.listIds) setLists(id, patch.listIds)
  if (patch.tags) setTags(id, patch.tags)
  return getContact(id)
}

export function deleteContact(id: number): void {
  if (!getDb().get<{ id: number }>('SELECT id FROM contacts WHERE id = ?', id)) throw notFound('Contact not found')
  getDb().run('DELETE FROM contacts WHERE id = ?', id)
}

export function deleteContacts(ids: number[]): number {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  return getDb().run(`DELETE FROM contacts WHERE id IN (${placeholders})`, ...ids).changes
}

export function setLists(contactId: number, listIds: number[]): void {
  const ids = uniqueBy(
    listIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
    (value) => value,
  )
  getDb().transaction(() => {
    getDb().run('DELETE FROM contact_lists WHERE contact_id = ?', contactId)
    for (const listId of ids) {
      getDb().run('INSERT OR IGNORE INTO contact_lists (contact_id, list_id, added_at) VALUES (?, ?, ?)', contactId, listId, nowIso())
    }
  })
}

export function setTags(contactId: number, tagNames: string[]): void {
  const tags = resolveTags(tagNames)
  getDb().transaction(() => {
    getDb().run('DELETE FROM contact_tags WHERE contact_id = ?', contactId)
    for (const tag of tags) getDb().run('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', contactId, tag.id)
  })
}

export function addTags(contactId: number, tagNames: string[]): void {
  for (const tag of resolveTags(tagNames)) getDb().run('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)', contactId, tag.id)
}

function resolveTags(names: string[]): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = []
  for (const raw of names) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    const tag = getOrCreateTag(name)
    if (!out.some((t) => t.id === tag.id)) out.push({ id: tag.id, name: tag.name })
  }
  return out
}

export function addToLists(contactId: number, listIds: number[]): void {
  for (const listId of listIds) {
    getDb().run('INSERT OR IGNORE INTO contact_lists (contact_id, list_id, added_at) VALUES (?, ?, ?)', contactId, listId, nowIso())
  }
}

export function unsubscribe(emailOrId: string | number, reason = 'unsubscribe link'): ContactDto | null {
  const id = typeof emailOrId === 'number' ? emailOrId : contactIdFor(emailOrId)
  if (!id) return null
  const now = nowIso()
  getDb().run('UPDATE contacts SET status = ?, unsubscribed_at = ?, updated_at = ? WHERE id = ?', 'unsubscribed', now, now, id)
  getDb().run(`UPDATE sends SET status = 'skipped', error = ?, updated_at = ? WHERE contact_id = ? AND status = 'queued'`, `contact ${reason}`, now, id)
  return getContact(id)
}

export function markStatus(contactId: number, status: ContactStatus, reason?: string): void {
  const now = nowIso()
  getDb().run('UPDATE contacts SET status = ?, unsubscribed_at = ?, updated_at = ? WHERE id = ?', status, status === 'subscribed' ? null : now, now, contactId)
  if (status !== 'subscribed') {
    getDb().run(`UPDATE sends SET status = 'skipped', error = ?, updated_at = ? WHERE contact_id = ? AND status = 'queued'`, reason ?? `contact ${status}`, now, contactId)
  }
}

/** Opt-in path shared by the UI, CSV import and the public subscribe endpoint. */
export function subscribe(input: {
  email: string
  name?: string
  fields?: Record<string, string>
  listIds?: number[]
  tags?: string[]
  status?: ContactStatus
  source?: string
}): { contact: ContactDto; created: boolean } {
  const email = normalizeEmail(input.email)
  if (!email) throw badRequest('Email is required')

  const existing = getDb().get<ContactRow>('SELECT * FROM contacts WHERE email = ?', email)
  if (!existing) {
    const contact = createContact({
      email,
      name: input.name,
      fields: { ...(input.fields ?? {}), source: input.source ?? 'manual' },
      status: input.status ?? 'subscribed',
      listIds: input.listIds,
      tags: input.tags,
    })
    return { contact, created: true }
  }

  const fields = { ...jsonParse<Record<string, string>>(existing.fields, {}), ...(input.fields ?? {}) }
  getDb().run(
    'UPDATE contacts SET name = ?, fields = ?, status = ?, unsubscribed_at = NULL, updated_at = ? WHERE id = ?',
    input.name?.trim() || existing.name,
    fields,
    input.status ?? 'subscribed',
    nowIso(),
    existing.id,
  )
  if (input.listIds?.length) addToLists(existing.id, input.listIds)
  if (input.tags?.length) addTags(existing.id, input.tags)
  return { contact: getContact(existing.id), created: false }
}

/* ── segments ──────────────────────────────────────────────────────────────── */

function segmentWhere(segment: Partial<Segment> | undefined): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  const s = segment ?? {}
  const statuses = s.statuses?.length ? s.statuses : ['subscribed']
  clauses.push(`c.status IN (${statuses.map(() => '?').join(',')})`)
  params.push(...statuses)

  if (s.listIds?.length) {
    clauses.push(`EXISTS (SELECT 1 FROM contact_lists cl WHERE cl.contact_id = c.id AND cl.list_id IN (${s.listIds.map(() => '?').join(',')}))`)
    params.push(...s.listIds)
  }
  if (s.tagIds?.length) {
    const marks = s.tagIds.map(() => '?').join(',')
    clauses.push(
      s.tagMatch === 'all'
        ? `(SELECT COUNT(DISTINCT ct.tag_id) FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${marks})) = ${s.tagIds.length}`
        : `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${marks}))`,
    )
    params.push(...s.tagIds)
  }
  if (s.excludeListIds?.length) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM contact_lists cl WHERE cl.contact_id = c.id AND cl.list_id IN (${s.excludeListIds.map(() => '?').join(',')}))`)
    params.push(...s.excludeListIds)
  }
  if (s.excludeTagIds?.length) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${s.excludeTagIds.map(() => '?').join(',')}))`)
    params.push(...s.excludeTagIds)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function countSegment(segment: Partial<Segment> | undefined): number {
  const { sql, params } = segmentWhere(segment)
  return getDb().count(`SELECT COUNT(*) FROM contacts c ${sql}`, ...params)
}

export interface RecipientRow {
  id: number
  email: string
  name: string
  fields: string
}

export function recipientsForSegment(segment: Partial<Segment> | undefined, limit = 100_000): RecipientRow[] {
  const { sql, params } = segmentWhere(segment)
  return getDb().all<RecipientRow>(`SELECT c.id, c.email, c.name, c.fields FROM contacts c ${sql} ORDER BY c.id LIMIT ?`, ...params, limit)
}

/* ── import / export ─────────────────────────────────────────────────────────── */

export interface ImportResult {
  created: number
  updated: number
  skipped: { line: number; reason: string }[]
  total: number
  tagsCreated: number
  columns: string[]
}

export function importCsv(input: {
  csv: string
  listId?: number
  defaultStatus?: ContactStatus
  duplicatePolicy?: 'skip' | 'update'
  tags?: string[]
}): ImportResult {
  const parsed = csvToContacts(input.csv)
  const result: ImportResult = { created: 0, updated: 0, skipped: [...parsed.skipped], total: parsed.contacts.length, tagsCreated: 0, columns: parsed.columns }
  const extraTags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  const tagsBefore = listTags().length

  getDb().transaction(() => {
    for (const [index, row] of parsed.contacts.entries()) {
      const email = normalizeEmail(row.email)
      if (!email.includes('@') || !email.includes('.')) {
        result.skipped.push({ line: index + 1, reason: `invalid email “${row.email}”` })
        continue
      }
      const rowTags = (row.fields?.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
      const tags = [...rowTags, ...extraTags]
      const fields = { ...row.fields }
      delete fields.tags

      const existing = getDb().get<ContactRow>('SELECT * FROM contacts WHERE email = ?', email)
      if (existing) {
        if (input.duplicatePolicy === 'skip') {
          result.skipped.push({ line: index + 1, reason: 'duplicate kept as-is' })
          continue
        }
        const merged = { ...jsonParse<Record<string, string>>(existing.fields, {}), ...fields }
        getDb().run(
          'UPDATE contacts SET name = ?, fields = ?, status = ?, unsubscribed_at = NULL, updated_at = ? WHERE id = ?',
          row.name || existing.name,
          merged,
          input.defaultStatus ?? 'subscribed',
          nowIso(),
          existing.id,
        )
        if (input.listId) addToLists(existing.id, [input.listId])
        if (tags.length) addTags(existing.id, tags)
        result.updated += 1
        continue
      }

      const insert = getDb().run(
        'INSERT INTO contacts (email, name, fields, status, unsubscribed_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
        email,
        row.name,
        fields,
        input.defaultStatus ?? 'subscribed',
        nowIso(),
        nowIso(),
      )
      if (input.listId) addToLists(insert.lastInsertRowid, [input.listId])
      if (tags.length) setTags(insert.lastInsertRowid, tags)
      result.created += 1
    }
  })

  result.tagsCreated = listTags().length - tagsBefore
  if (!result.total) result.skipped.push({ line: 0, reason: 'No rows found — the file needs an `email` column' })
  return result
}

export function exportCsv(filter: ContactFilter = {}): string {
  const { items } = listContacts({ ...filter, page: 1, perPage: 200, status: filter.status ?? 'all' })
  const rows = items.map((contact) => ({
    email: contact.email,
    name: contact.name,
    status: contact.status,
    tags: contact.tags.map((tag) => tag.name).join(','),
    lists: contact.lists.map((list) => list.name).join(','),
    ...contact.fields,
  }))
  const columns = uniqueBy(rows.flatMap((row) => Object.keys(row)), (column) => column)
  return toCsv(rows, columns)
}

/** Distinct custom-field keys — drives table columns and merge-tag hints. */
export function fieldKeys(limit = 40): string[] {
  const rows = getDb().all<{ fields: string }>('SELECT fields FROM contacts ORDER BY id DESC LIMIT 500')
  const seen: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(jsonParse<Record<string, string>>(row.fields, {}))) {
      if (key !== 'tags' && !seen.includes(key)) seen.push(key)
    }
  }
  return seen.slice(0, limit)
}

export interface AudienceTotals {
  contacts: number
  subscribed: number
  unsubscribed: number
  bounced: number
  complained: number
  newThisWeek: number
}

export function audienceTotals(): AudienceTotals {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const stats = getDb().get<Record<string, number | null>>(
    `SELECT COUNT(*) AS contacts,
            SUM(CASE WHEN status = 'subscribed' THEN 1 ELSE 0 END) AS subscribed,
            SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
            SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complained,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_this_week
     FROM contacts`,
    weekAgo,
  )
  const num = (value: unknown) => Number(value ?? 0)
  return {
    contacts: num(stats?.contacts),
    subscribed: num(stats?.subscribed),
    unsubscribed: num(stats?.unsubscribed),
    bounced: num(stats?.bounced),
    complained: num(stats?.complained),
    newThisWeek: num(stats?.new_this_week),
  }
}
