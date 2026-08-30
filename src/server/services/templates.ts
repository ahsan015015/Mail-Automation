import { getDb } from '../db/sqlite.js'
import { sanitizeEmailHtml, htmlToText } from '../lib/html.js'
import { conflict, notFound, nowIso, truncate } from '../lib/util.js'
import type { Paged, TemplateDto } from '../../shared/types.js'

interface Row {
  id: number
  name: string
  subject: string
  preheader: string
  html: string
  text: string
  created_at: string
  updated_at: string
}

const map = (row: Row): TemplateDto => ({
  id: row.id,
  name: row.name,
  subject: row.subject ?? '',
  preheader: row.preheader ?? '',
  html: row.html ?? '',
  text: row.text ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function listTemplates(filter: { q?: string; page?: number; perPage?: number } = {}): Paged<TemplateDto> {
  const page = Math.max(1, Number(filter.page ?? 1) || 1)
  const perPage = Math.min(200, Math.max(5, Number(filter.perPage ?? 50) || 50))
  const q = (filter.q ?? '').trim().toLowerCase()
  const where = q ? 'WHERE LOWER(name) LIKE ? OR LOWER(subject) LIKE ?' : ''
  const params: unknown[] = q ? [`%${q}%`, `%${q}%`] : []
  const total = getDb().count(`SELECT COUNT(*) FROM templates ${where}`, ...params)
  const rows = getDb().all<Row>(`SELECT * FROM templates ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage)
  return { items: rows.map(map), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

export function getTemplate(id: number): TemplateDto {
  const row = getDb().get<Row>('SELECT * FROM templates WHERE id = ?', id)
  if (!row) throw notFound('Template not found')
  return map(row)
}

export function templateByName(name: string): TemplateDto | null {
  const row = getDb().get<Row>('SELECT * FROM templates WHERE name = ?', name.trim())
  return row ? map(row) : null
}

export function createTemplate(input: { name: string; subject?: string; preheader?: string; html?: string; text?: string }): TemplateDto {
  const name = input.name.trim()
  if (templateByName(name)) throw conflict(`A template called “${name}” already exists`)
  const html = sanitizeEmailHtml(input.html ?? '')
  const now = nowIso()
  const result = getDb().run(
    'INSERT INTO templates (name, subject, preheader, html, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name,
    (input.subject ?? '').trim(),
    (input.preheader ?? '').trim(),
    html,
    (input.text ?? '').trim() || htmlToText(html),
    now,
    now,
  )
  return getTemplate(result.lastInsertRowid)
}

export function updateTemplate(id: number, patch: Partial<{ name: string; subject: string; preheader: string; html: string; text: string }>): TemplateDto {
  const current = getTemplate(id)
  const name = patch.name?.trim() || current.name
  if (name !== current.name) {
    const clash = getDb().get<{ id: number }>('SELECT id FROM templates WHERE name = ? AND id <> ?', name, id)
    if (clash) throw conflict(`A template called “${name}” already exists`)
  }
  const html = patch.html === undefined ? current.html : sanitizeEmailHtml(patch.html)
  const text = patch.text === undefined ? current.text || htmlToText(html) : patch.text.trim() || htmlToText(html)
  getDb().run(
    'UPDATE templates SET name = ?, subject = ?, preheader = ?, html = ?, text = ?, updated_at = ? WHERE id = ?',
    name,
    patch.subject ?? current.subject,
    patch.preheader ?? current.preheader,
    html,
    text,
    nowIso(),
    id,
  )
  return getTemplate(id)
}

export function deleteTemplate(id: number): void {
  getTemplate(id)
  getDb().run('DELETE FROM templates WHERE id = ?', id)
}

export function duplicateTemplate(id: number): TemplateDto {
  const source = getTemplate(id)
  const base = `${source.name} copy`
  let name = base
  let n = 2
  while (templateByName(name)) name = `${base} ${n++}`
  return createTemplate({ ...source, name })
}

/** Used by the campaign wizard: which templates mention `subject` etc. */
export function templateSummaries(): { id: number; name: string; subjectPreview: string }[] {
  return getDb().all<{ id: number; name: string; subject: string }>('SELECT id, name, subject FROM templates ORDER BY name COLLATE NOCASE').map((row) => ({
    id: row.id,
    name: row.name,
    subjectPreview: truncate(row.subject || '(no subject)', 90),
  }))
}
