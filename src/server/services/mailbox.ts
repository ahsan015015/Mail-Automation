import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.js'
import { getDb } from '../db/sqlite.js'
import { jsonParse, nowIso, toJson, truncate } from '../lib/util.js'
import type { MailboxMessageDto, Paged } from '../../shared/types.js'

/**
 * Local mail catcher. When the transport is not a real SMTP server every
 * rendered message lands here, which makes the whole pipeline (personalisation,
 * tracking URLs, unsubscribe footer) observable without any credentials.
 */

interface Row {
  id: number
  to_email: string
  to_name: string
  from_email: string
  from_name: string
  reply_to: string
  subject: string
  html: string
  text: string
  headers: string
  message_id: string | null
  send_id: number | null
  campaign_id: number | null
  eml_path: string | null
  simulated_open_at: string | null
  created_at: string
}

const map = (row: Row): MailboxMessageDto => ({
  id: row.id,
  toEmail: row.to_email,
  toName: row.to_name ?? '',
  fromEmail: row.from_email ?? '',
  fromName: row.from_name ?? '',
  replyTo: row.reply_to ?? '',
  subject: row.subject ?? '',
  html: row.html ?? '',
  text: row.text ?? '',
  headers: jsonParse<Record<string, string>>(row.headers, {}),
  messageId: row.message_id,
  sendId: row.send_id,
  campaignId: row.campaign_id,
  emlPath: row.eml_path,
  simulatedOpenAt: row.simulated_open_at,
  createdAt: row.created_at,
})

const slug = (value: string) =>
  String(value || 'message')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'message'

function writeEml(id: number, subject: string, raw: Buffer | null): string | null {
  if (!raw) return null
  try {
    fs.mkdirSync(config.mailDir, { recursive: true })
    const file = path.join(config.mailDir, `${String(id).padStart(6, '0')}-${slug(subject)}.eml`)
    fs.writeFileSync(file, raw)
    return file
  } catch {
    return null
  }
}

export function saveMessage(input: {
  toEmail: string
  toName?: string
  fromEmail?: string
  fromName?: string
  replyTo?: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  messageId?: string | null
  sendId?: number | null
  campaignId?: number | null
  raw?: Buffer | null
}): MailboxMessageDto {
  const now = nowIso()
  const result = getDb().run(
    `INSERT INTO mailbox (to_email, to_name, from_email, from_name, reply_to, subject, html, text, headers,
                          message_id, send_id, campaign_id, eml_path, simulated_open_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    input.toEmail,
    input.toName ?? '',
    input.fromEmail ?? '',
    input.fromName ?? '',
    input.replyTo ?? '',
    truncate(input.subject, 300),
    input.html ?? '',
    input.text ?? '',
    toJson(input.headers ?? {}),
    input.messageId ?? null,
    input.sendId ?? null,
    input.campaignId ?? null,
    now,
  )
  const id = result.lastInsertRowid
  const emlPath = writeEml(id, input.subject, input.raw ?? null)
  if (emlPath) getDb().run('UPDATE mailbox SET eml_path = ? WHERE id = ?', emlPath, id)
  return getMessage(id)!
}

export function getMessage(id: number): MailboxMessageDto | null {
  const row = getDb().get<Row>('SELECT * FROM mailbox WHERE id = ?', id)
  return row ? map(row) : null
}

export function messageForSend(sendId: number): MailboxMessageDto | null {
  const row = getDb().get<Row>('SELECT * FROM mailbox WHERE send_id = ? ORDER BY id DESC LIMIT 1', sendId)
  return row ? map(row) : null
}

export function listMessages(filter: { q?: string; campaignId?: number; page?: number; perPage?: number } = {}): Paged<MailboxMessageDto> {
  const page = Math.max(1, Number(filter.page ?? 1) || 1)
  const perPage = Math.min(100, Math.max(5, Number(filter.perPage ?? 20) || 20))
  const clauses: string[] = []
  const params: unknown[] = []
  const q = (filter.q ?? '').trim().toLowerCase()
  if (q) {
    clauses.push('(LOWER(to_email) LIKE ? OR LOWER(subject) LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (filter.campaignId) {
    clauses.push('campaign_id = ?')
    params.push(filter.campaignId)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = getDb().count(`SELECT COUNT(*) FROM mailbox ${where}`, ...params)
  const rows = getDb().all<Row>(`SELECT * FROM mailbox ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage)
  return { items: rows.map(map), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

export function simulateOpen(id: number): MailboxMessageDto | null {
  const message = getMessage(id)
  if (!message) return null
  const now = nowIso()
  getDb().run('UPDATE mailbox SET simulated_open_at = ? WHERE id = ?', now, id)
  if (message.sendId) {
    getDb().run(
      `UPDATE sends SET open_count = open_count + 1, opened_at = COALESCE(opened_at, ?), updated_at = ? WHERE id = ?`,
      now,
      now,
      message.sendId,
    )
  }
  return getMessage(id)
}

export function clearMailbox(): number {
  const count = getDb().count('SELECT COUNT(*) FROM mailbox')
  getDb().run('DELETE FROM mailbox')
  try {
    if (fs.existsSync(config.mailDir)) {
      for (const file of fs.readdirSync(config.mailDir)) {
        if (file.endsWith('.eml')) fs.unlinkSync(path.join(config.mailDir, file))
      }
    }
  } catch {
    /* best effort */
  }
  return count
}

export function mailboxDir(): string {
  return config.mailDir
}
