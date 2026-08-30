import type { Response } from 'express'
import { getDb } from '../db/sqlite.js'
import { logger } from '../lib/log.js'
import { jsonParse, nowIso, toJson, truncate } from '../lib/util.js'
import type { EventDto, EventKind } from '../../shared/types.js'

interface Row {
  id: number
  kind: EventKind
  campaign_id: number | null
  contact_id: number | null
  send_id: number | null
  message: string
  meta: string
  created_at: string
}

const toDto = (row: Row): EventDto => ({
  id: row.id,
  kind: row.kind,
  campaignId: row.campaign_id,
  campaignName: null,
  contactId: row.contact_id,
  contactEmail: null,
  sendId: row.send_id,
  message: row.message,
  meta: jsonParse<Record<string, unknown>>(row.meta, {}),
  createdAt: row.created_at,
})

export interface EventInput {
  kind: EventKind
  message: string
  campaignId?: number | null
  contactId?: number | null
  sendId?: number | null
  meta?: Record<string, unknown>
}

/** Persist + broadcast an activity entry. Never throws: telemetry must not break sends. */
export function recordEvent(input: EventInput): EventDto | null {
  try {
    const createdAt = nowIso()
    const result = getDb().run(
      `INSERT INTO events (kind, campaign_id, contact_id, send_id, message, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.kind,
      input.campaignId ?? null,
      input.contactId ?? null,
      input.sendId ?? null,
      truncate(input.message, 400),
      toJson(input.meta ?? {}),
      createdAt,
    )
    const event: EventDto = {
      id: result.lastInsertRowid,
      kind: input.kind,
      campaignId: input.campaignId ?? null,
      campaignName: (input.meta?.campaignName as string) ?? null,
      contactId: input.contactId ?? null,
      contactEmail: (input.meta?.email as string) ?? null,
      sendId: input.sendId ?? null,
      message: input.message,
      meta: input.meta ?? {},
      createdAt,
    }
    bus.publish('event', event)
    return event
  } catch (error) {
    logger.debug('event write failed', error instanceof Error ? error.message : error)
    return null
  }
}

export function listEvents(limit = 40, campaignId?: number): EventDto[] {
  const rows = campaignId
    ? getDb().all<Row>(`SELECT * FROM events WHERE campaign_id = ? ORDER BY id DESC LIMIT ?`, campaignId, limit)
    : getDb().all<Row>(`SELECT * FROM events ORDER BY id DESC LIMIT ?`, limit)
  return decorate(rows)
}

export function contactEvents(contactId: number, limit = 50): EventDto[] {
  return decorate(getDb().all<Row>(`SELECT * FROM events WHERE contact_id = ? ORDER BY id DESC LIMIT ?`, contactId, limit))
}

function decorate(rows: Row[]): EventDto[] {
  if (!rows.length) return []
  const campaigns = new Map<number, string>()
  const contacts = new Map<number, string>()
  for (const row of rows) {
    if (row.campaign_id && !campaigns.has(row.campaign_id)) {
      const name = getDb().get<{ name: string }>('SELECT name FROM campaigns WHERE id = ?', row.campaign_id)?.name
      if (name) campaigns.set(row.campaign_id, name)
    }
    if (row.contact_id && !contacts.has(row.contact_id)) {
      const email = getDb().get<{ email: string }>('SELECT email FROM contacts WHERE id = ?', row.contact_id)?.email
      if (email) contacts.set(row.contact_id, email)
    }
  }
  return rows.map((row) => ({
    ...toDto(row),
    campaignName: row.campaign_id ? campaigns.get(row.campaign_id) ?? null : null,
    contactEmail: row.contact_id ? contacts.get(row.contact_id) ?? null : null,
  }))
}

/* ── SSE fan-out ───────────────────────────────────────────────────────────── */

type Listener = (type: string, payload: unknown) => void

class Bus {
  private listeners = new Set<Listener>()

  publish(type: string, payload: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(type, payload)
      } catch {
        this.listeners.delete(listener)
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get size(): number {
    return this.listeners.size
  }

  /** Attach an Express response as a Server-Sent Events stream. */
  attach(res: Response): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (type: string, payload: unknown) => {
      if (res.writableEnded) return
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
    }
    const unsubscribe = this.subscribe(send)
    send('ready', { ok: true, at: nowIso() })
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`: ping ${nowIso()}\n\n`)
    }, 20_000)
    heartbeat.unref?.()
    return () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
  }
}

export const bus = new Bus()
