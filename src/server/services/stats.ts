import { getDb } from '../db/sqlite.js'
import { rate, round } from '../lib/util.js'
import { audienceTotals } from './contacts.js'
import { listEvents } from './events.js'
import { engine } from './engine.js'
import type { DashboardDto, FunnelPoint } from '../../shared/types.js'

const hourKeyOf = (iso: string | null): string => String(iso ?? '').slice(0, 13)

function bucketize(hours: number, rows: { hour: string; value: number }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.hour, Number(row.value ?? 0))
  const out = new Map<string, number>()
  const now = new Date()
  for (let i = hours - 1; i >= 0; i--) {
    const key = new Date(now.getTime() - i * 3_600_000).toISOString().slice(0, 13)
    out.set(key, map.get(key) ?? 0)
  }
  return out
}

export interface HourPoint {
  hour: string
  sent: number
  opens: number
  clicks: number
}

export function hourlySeries(hours = 24): HourPoint[] {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const sent = getDb().all<{ hour: string; value: number }>(
    `SELECT substr(sent_at, 1, 13) AS hour, COUNT(*) AS value FROM sends WHERE status = 'sent' AND sent_at >= ? GROUP BY hour`,
    since,
  )
  const opens = getDb().all<{ hour: string; value: number }>(
    `SELECT substr(opened_at, 1, 13) AS hour, COUNT(*) AS value FROM sends WHERE opened_at IS NOT NULL AND opened_at >= ? GROUP BY hour`,
    since,
  )
  const clicks = getDb().all<{ hour: string; value: number }>(
    `SELECT substr(clicked_at, 1, 13) AS hour, COUNT(*) AS value FROM sends WHERE clicked_at IS NOT NULL AND clicked_at >= ? GROUP BY hour`,
    since,
  )
  const sentMap = bucketize(hours, sent)
  const openMap = bucketize(hours, opens)
  const clickMap = bucketize(hours, clicks)
  return [...sentMap.keys()].map((hour) => ({ hour, sent: sentMap.get(hour) ?? 0, opens: openMap.get(hour) ?? 0, clicks: clickMap.get(hour) ?? 0 }))
}

/** Per-hour funnel for a single campaign (used by the campaign detail chart). */
export function campaignSeries(campaignId: number, hours = 24): HourPoint[] {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  const query = (column: 'sent_at' | 'opened_at' | 'clicked_at') =>
    getDb().all<{ hour: string; value: number }>(
      `SELECT substr(${column}, 1, 13) AS hour, COUNT(*) AS value FROM sends
       WHERE campaign_id = ? AND ${column} IS NOT NULL AND ${column} >= ? GROUP BY hour`,
      campaignId,
      since,
    )
  const sentMap = bucketize(hours, query('sent_at'))
  const openMap = bucketize(hours, query('opened_at'))
  const clickMap = bucketize(hours, query('clicked_at'))
  return [...sentMap.keys()].map((hour) => ({ hour, sent: sentMap.get(hour) ?? 0, opens: openMap.get(hour) ?? 0, clicks: clickMap.get(hour) ?? 0 }))
}

export function dashboard(): DashboardDto {
  const audience = audienceTotals()
  const delivery = getDb().get<Record<string, number | null>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent'    THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
            SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status IN ('queued','sending') THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS unique_opens,
            SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) AS unique_clicks
     FROM sends`,
  ) ?? {}
  const todayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString()
  const num = (value: unknown) => Number(value ?? 0)
  const sent = num(delivery.sent)

  const lists = getDb().count('SELECT COUNT(*) FROM lists WHERE archived = 0')
  const templates = getDb().count('SELECT COUNT(*) FROM templates')
  const running = getDb().count(`SELECT COUNT(*) FROM campaigns WHERE status = 'running'`)
  const scheduled = getDb().count(`SELECT COUNT(*) FROM campaigns WHERE status = 'scheduled'`)

  const topCampaigns = getDb()
    .all<{ id: number; name: string; status: DashboardDto['topCampaigns'][number]['status']; sent: number; recipients: number; uniq_opens: number; uniq_clicks: number }>(
      `SELECT c.id, c.name, c.status,
              (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id AND s.status = 'sent') AS sent,
              (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id) AS recipients,
              (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id AND s.open_count > 0) AS uniq_opens,
              (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = c.id AND s.click_count > 0) AS uniq_clicks
       FROM campaigns c
       ORDER BY sent DESC, c.updated_at DESC
       LIMIT 6`,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      sent: Number(row.sent ?? 0),
      recipients: Number(row.recipients ?? 0),
      openRate: rate(Number(row.uniq_opens ?? 0), Number(row.sent ?? 0)),
      clickRate: rate(Number(row.uniq_clicks ?? 0), Number(row.sent ?? 0)),
    }))

  return {
    totals: {
      contacts: audience.contacts,
      subscribed: audience.subscribed,
      unsubscribed: audience.unsubscribed,
      bounced: audience.bounced,
      lists,
      templates,
      campaignsRunning: running,
      campaignsScheduled: scheduled,
      queued: num(delivery.queued),
      sentToday: getDb().count(`SELECT COUNT(*) FROM sends WHERE status = 'sent' AND sent_at >= ?`, todayStart),
      sent,
      opens: num(delivery.unique_opens),
      clicks: num(delivery.unique_clicks),
      openRate: rate(num(delivery.unique_opens), sent),
      clickRate: rate(num(delivery.unique_clicks), sent),
    },
    series: hourlySeries(24).map((point) => ({ hour: point.hour, sent: point.sent, opens: point.opens, clicks: point.clicks })),
    topCampaigns,
    recentEvents: listEvents(14),
    engine: {
      running: engine.isRunning,
      tickMs: engine.status().tickMs,
      queueDepth: engine.status().queueDepth,
      lastTickAt: engine.status().lastTickAt,
      tickDurationMs: round(engine.status().tickDurationMs, 0),
      transport: engine.status().transport,
      activeCampaigns: running + scheduled,
    },
  }
}

export function funnelFor(campaignId: number): FunnelPoint[] {
  const row = getDb().get<Record<string, number | null>>(
    `SELECT COUNT(*) AS queued,
            SUM(CASE WHEN status IN ('sent','bounced') THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
            SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) AS clicked
     FROM sends WHERE campaign_id = ?`,
    campaignId,
  ) ?? {}
  const total = Number(row.queued ?? 0) || 1
  const value = (key: string) => Number(row[key] ?? 0)
  return [
    { label: 'Queued', value: value('queued') || total, percent: 100 },
    { label: 'Delivered', value: value('delivered'), percent: round((value('delivered') / total) * 100, 1) },
    { label: 'Opened', value: value('opened'), percent: round((value('opened') / total) * 100, 1) },
    { label: 'Clicked', value: value('clicked'), percent: round((value('clicked') / total) * 100, 1) },
  ]
}

/** Subscriber growth per day — powers the audience card sparkline. */
export function growthSeries(days = 14): { day: string; added: number; unsubscribed: number }[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const added = new Map(
    getDb().all<{ day: string; value: number }>(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM contacts WHERE created_at >= ? GROUP BY day`, since).map((row) => [row.day, Number(row.value)]),
  )
  const gone = new Map(
    getDb().all<{ day: string; value: number }>(
      `SELECT substr(unsubscribed_at, 1, 10) AS day, COUNT(*) AS value FROM contacts WHERE unsubscribed_at IS NOT NULL AND unsubscribed_at >= ? GROUP BY day`,
      since,
    ).map((row) => [row.day, Number(row.value)]),
  )
  const out: { day: string; added: number; unsubscribed: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ day, added: added.get(day) ?? 0, unsubscribed: gone.get(day) ?? 0 })
  }
  return out
}

export { hourKeyOf }
