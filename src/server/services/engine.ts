import { config } from '../lib/config.js'
import { logger } from '../lib/log.js'
import { publicOrigin } from '../lib/public-origin.js'
import { addSeconds, jsonParse, localHour, localWeekend, nowIso, sleep } from '../lib/util.js'
import { getDb } from '../db/sqlite.js'
import { getSettings, type ResolvedSettings } from './settings.js'
import { bus, recordEvent } from './events.js'
import { deliver, isPermanentFailure } from './mailer.js'
import { renderMessage } from './render.js'
import { saveMessage } from './mailbox.js'
import { markStatus } from './contacts.js'
import type { CampaignSchedule, Segment } from '../../shared/types.js'

const BATCH_LIMIT = 40

export interface TickResult {
  processed: number
  sent: number
  failed: number
  skipped: number
  activated: number
  completed: number
  ms: number
}

interface SendJob {
  send_id: number
  campaign_id: number
  campaign_name: string
  step_id: number
  position: number
  skip_if_opened: number
  skip_if_clicked: number
  subject: string
  preheader: string
  html: string
  text: string
  from_name: string
  from_email: string
  reply_to: string
  tracking: string
  schedule: string
  segment: string
  contact_id: number | null
  email: string | null
  name: string | null
  fields: string | null
  contact_status: string | null
  attempts: number
}

/**
 * Pull-based sending engine: SQLite is the queue, so a restart resumes exactly
 * where it left off. Rate limits, daily caps, sending windows, retries with
 * exponential backoff and per-campaign throttling are all evaluated per tick.
 */
export class SendingEngine {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private lastTickAt: string | null = null
  private lastTickMs = 0
  private lifetime = { sent: 0, failed: 0, skipped: 0 }

  get isRunning(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    const ms = Math.max(200, config.engine.tickMs)
    this.timer = setInterval(() => {
      void this.tick().catch((error) => logger.error('engine', error instanceof Error ? error.message : error))
    }, ms)
    this.timer.unref?.()
    logger.info(`engine: ticking every ${ms}ms (transport: ${this.transport})`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get transport(): 'smtp' | 'memory' {
    const settings = getSettings()
    return settings.transport === 'memory' || !settings.smtp.host ? 'memory' : 'smtp'
  }

  status() {
    const queueDepth = getDb().count(`SELECT COUNT(*) FROM sends WHERE status IN ('queued','sending')`)
    return {
      running: this.isRunning,
      tickMs: Math.max(200, config.engine.tickMs),
      queueDepth,
      lastTickAt: this.lastTickAt,
      tickDurationMs: this.lastTickMs,
      transport: this.transport,
      lifetime: { ...this.lifetime },
    }
  }

  /** Flip due campaigns from `scheduled` to `running`. */
  private activate(now: Date): number {
    const iso = now.toISOString()
    const due = getDb().all<{ id: number; name: string }>(
      `SELECT id, name FROM campaigns WHERE status = 'scheduled' AND scheduled_start_at IS NOT NULL AND scheduled_start_at <= ?`,
      iso,
    )
    if (!due.length) return 0
    for (const campaign of due) {
      getDb().run(`UPDATE campaigns SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`, iso, iso, campaign.id)
      recordEvent({ kind: 'campaign.started', campaignId: campaign.id, message: `Scheduled start reached — sending`, meta: { campaignName: campaign.name } })
    }
    return due.length
  }

  private sentSince(iso: string, campaignId?: number): number {
    return campaignId
      ? getDb().count(`SELECT COUNT(*) FROM sends WHERE status = 'sent' AND sent_at >= ? AND campaign_id = ?`, iso, campaignId)
      : getDb().count(`SELECT COUNT(*) FROM sends WHERE status = 'sent' AND sent_at >= ?`, iso)
  }

  /** Send inside the campaign's local window only (falling back to workspace defaults). */
  private inWindow(schedule: CampaignSchedule, settings: ResolvedSettings, date: Date): boolean {
    const timezone = schedule.timezone || settings.sending.timezone || 'UTC'
    const start = schedule.windowStartHour ?? settings.sending.windowStartHour
    const end = schedule.windowEndHour ?? settings.sending.windowEndHour
    if (schedule.skipWeekends && localWeekend(date, timezone)) return false
    if (start === null || end === null || start === end) return true
    const hour = localHour(date, timezone)
    return start < end ? hour >= start && hour < end : hour >= start || hour < end
  }

  async tick(options: { ignoreLimits?: boolean } = {}): Promise<TickResult> {
    const startedAt = Date.now()
    const result: TickResult = { processed: 0, sent: 0, failed: 0, skipped: 0, activated: 0, completed: 0, ms: 0 }
    if (this.busy) return { ...result, ms: 0 }
    this.busy = true
    try {
      const settings = getSettings()
      const now = new Date()
      result.activated = this.activate(now)

      const windowStart = new Date(now.getTime() - 60_000).toISOString()
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
      const globalSentLastMinute = options.ignoreLimits ? 0 : this.sentSince(windowStart)
      const globalBudget = options.ignoreLimits ? BATCH_LIMIT : Math.max(0, settings.sending.ratePerMinute - globalSentLastMinute)
      const globalDailyLeft = options.ignoreLimits ? BATCH_LIMIT : Math.max(0, settings.sending.dailyCap - this.sentSince(dayStart))
      let remaining = Math.min(BATCH_LIMIT, globalBudget, globalDailyLeft)

      const campaigns = getDb().all<{ id: number; schedule: string }>(`SELECT id, schedule FROM campaigns WHERE status = 'running' ORDER BY id`)
      for (const campaignRow of campaigns) {
        if (remaining <= 0) break
        const schedule = jsonParse<CampaignSchedule>(campaignRow.schedule, {
          startAt: null,
          timezone: settings.sending.timezone,
          windowStartHour: null,
          windowEndHour: null,
          ratePerMinute: settings.sending.ratePerMinute,
          dailyCap: settings.sending.dailyCap,
          skipWeekends: false,
        })
        if (!options.ignoreLimits && !this.inWindow(schedule, settings, now)) continue

        const campaignSentLastMinute = options.ignoreLimits ? 0 : this.sentSince(windowStart, campaignRow.id)
        const campaignBudget = Math.max(0, (schedule.ratePerMinute || settings.sending.ratePerMinute) - campaignSentLastMinute)
        const campaignDailyLeft = options.ignoreLimits ? BATCH_LIMIT : Math.max(0, (schedule.dailyCap || settings.sending.dailyCap) - this.sentSince(dayStart, campaignRow.id))
        const limit = Math.min(remaining, campaignBudget, campaignDailyLeft)
        if (limit <= 0) continue

        const claimed = this.claim(campaignRow.id, limit, now)
        for (const job of claimed) {
          const outcome = await this.process(job, settings, now)
          result.processed += 1
          if (outcome === 'sent') result.sent += 1
          else if (outcome === 'skipped') result.skipped += 1
          else result.failed += 1
        }
        remaining -= claimed.length
      }

      result.completed = this.finalize()
      this.lastTickAt = nowIso()
      this.lastTickMs = Date.now() - startedAt
      if (result.processed || result.activated || result.completed) {
        bus.publish('engine', { ...result, queueDepth: getDb().count(`SELECT COUNT(*) FROM sends WHERE status IN ('queued','sending')`) })
      }
      return result
    } finally {
      this.busy = false
    }
  }

  /** Atomically take ownership of due rows so a crash mid-flight cannot double-send. */
  private claim(campaignId: number, limit: number, now: Date): SendJob[] {
    const iso = now.toISOString()
    const ids = getDb().all<{ id: number }>(
      `UPDATE sends SET status = 'sending', updated_at = ?
       WHERE id IN (
         SELECT id FROM sends
         WHERE campaign_id = ? AND status = 'queued' AND send_after <= ?
         ORDER BY send_after, id LIMIT ?
       ) RETURNING id`,
      iso,
      campaignId,
      iso,
      limit,
    )
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    return getDb().all<SendJob>(
      `SELECT s.id AS send_id, s.campaign_id, s.step_id, s.attempts,
              c.name AS campaign_name, c.from_name, c.from_email, c.reply_to, c.tracking, c.schedule, c.segment,
              st.position, st.subject, st.preheader, st.html, st.text, st.skip_if_opened, st.skip_if_clicked,
              ct.id AS contact_id, ct.email, ct.name, ct.fields, ct.status AS contact_status
       FROM sends s
       JOIN campaigns c ON c.id = s.campaign_id
       JOIN steps st ON st.id = s.step_id
       LEFT JOIN contacts ct ON ct.id = s.contact_id
       WHERE s.id IN (${placeholders}) ORDER BY s.send_after, s.id`,
      ...ids.map((row) => row.id),
    )
  }

  private async process(job: SendJob, settings: ResolvedSettings, now: Date): Promise<'sent' | 'failed' | 'skipped'> {
    const segment = jsonParse<Partial<Segment>>(job.segment, {})
    const allowedStatuses = new Set(segment.statuses?.length ? segment.statuses : ['subscribed'])

    if (!job.contact_id || !job.email || !job.contact_status) {
      this.markSkipped(job.send_id, 'contact no longer exists')
      return 'skipped'
    }
    if (!allowedStatuses.has(job.contact_status)) {
      this.markSkipped(job.send_id, `contact status is ${job.contact_status}`)
      return 'skipped'
    }
    if (job.skip_if_opened && this.openedBefore(job)) {
      this.markSkipped(job.send_id, 'contact already opened an earlier email')
      return 'skipped'
    }
    if (job.skip_if_clicked && this.clickedBefore(job)) {
      this.markSkipped(job.send_id, 'contact already clicked an earlier email')
      return 'skipped'
    }

    const tracking = jsonParse(job.tracking, { openTracking: true, clickTracking: true, includeUnsubscribe: true })
    const campaign = {
      id: job.campaign_id,
      name: job.campaign_name,
      fromName: job.from_name,
      fromEmail: job.from_email,
      replyTo: job.reply_to,
      tracking,
    }
    const rendered = renderMessage({
      campaign,
      step: { subject: job.subject, preheader: job.preheader, html: job.html, text: job.text },
      contact: {
        id: job.contact_id,
        email: job.email,
        name: job.name ?? '',
        fields: jsonParse<Record<string, string>>(job.fields, {}),
      },
      sendId: job.send_id,
      baseUrl: publicOrigin(),
      settings,
    })

    try {
      const info = await deliver(
        {
          to: { address: job.email, name: job.name ?? undefined },
          from: { address: campaign.fromEmail, name: campaign.fromName },
          replyTo: rendered.replyTo || undefined,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          headers: rendered.headers,
          messageId: rendered.messageId,
        },
        settings,
      )
      const iso = nowIso()
      getDb().run(
        `UPDATE sends SET status = 'sent', sent_at = ?, message_id = ?, transport = ?, attempts = attempts + 1,
                error = NULL, subject = ?, updated_at = ? WHERE id = ?`,
        iso,
        info.messageId,
        info.transport,
        rendered.subject,
        iso,
        job.send_id,
      )
      this.lifetime.sent += 1
      if (info.transport === 'memory') {
        saveMessage({
          toEmail: job.email,
          toName: job.name ?? '',
          fromEmail: campaign.fromEmail,
          fromName: campaign.fromName,
          replyTo: rendered.replyTo,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers: rendered.headers,
          messageId: info.messageId,
          sendId: job.send_id,
          campaignId: job.campaign_id,
          raw: info.raw,
        })
      }
      recordEvent({
        kind: 'send.sent',
        campaignId: job.campaign_id,
        contactId: job.contact_id,
        sendId: job.send_id,
        message: `${rendered.subject} → ${job.email}`,
        meta: { email: job.email, transport: info.transport, campaignName: job.campaign_name },
      })
      return 'sent'
    } catch (error) {
      this.handleFailure(job, error)
      return 'failed'
    }
  }

  private openedBefore(job: SendJob): boolean {
    return (
      getDb().count(
        `SELECT COUNT(*) FROM sends s JOIN steps st ON st.id = s.step_id
         WHERE s.campaign_id = ? AND s.contact_id = ? AND st.position < ? AND s.open_count > 0`,
        job.campaign_id,
        job.contact_id,
        job.position,
      ) > 0
    )
  }

  private clickedBefore(job: SendJob): boolean {
    return (
      getDb().count(
        `SELECT COUNT(*) FROM sends s JOIN steps st ON st.id = s.step_id
         WHERE s.campaign_id = ? AND s.contact_id = ? AND st.position < ? AND s.click_count > 0`,
        job.campaign_id,
        job.contact_id,
        job.position,
      ) > 0
    )
  }

  private markSkipped(sendId: number, reason: string): void {
    const iso = nowIso()
    getDb().run(`UPDATE sends SET status = 'skipped', error = ?, updated_at = ? WHERE id = ?`, reason, iso, sendId)
    this.lifetime.skipped += 1
    const row = getDb().get<{ campaign_id: number; to_email: string }>('SELECT campaign_id, to_email FROM sends WHERE id = ?', sendId)
    recordEvent({ kind: 'send.skipped', campaignId: row?.campaign_id, sendId, message: `Skipped: ${reason}`, meta: { email: row?.to_email } })
  }

  private handleFailure(job: SendJob, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const settings = getSettings()
    const attempts = Number(job.attempts ?? 0) + 1
    const permanent = isPermanentFailure(error)
    const exhausted = attempts >= settings.sending.maxAttempts
    const iso = nowIso()

    if (permanent || exhausted) {
      const status = permanent ? 'bounced' : 'failed'
      getDb().run(`UPDATE sends SET status = ?, error = ?, attempts = ?, updated_at = ? WHERE id = ?`, status, message.slice(0, 500), attempts, iso, job.send_id)
      this.lifetime.failed += 1
      if (permanent && job.contact_id) {
        markStatus(job.contact_id, 'bounced', 'hard bounce')
        recordEvent({ kind: 'contact.bounced', campaignId: job.campaign_id, contactId: job.contact_id, sendId: job.send_id, message: `Hard bounce: ${message.slice(0, 200)}`, meta: { email: job.email } })
      }
      recordEvent({
        kind: permanent ? 'send.bounced' : 'send.failed',
        campaignId: job.campaign_id,
        contactId: job.contact_id,
        sendId: job.send_id,
        message: permanent ? `Bounced: ${message.slice(0, 200)}` : `Failed after ${attempts} attempt(s): ${message.slice(0, 200)}`,
        meta: { email: job.email, permanent },
      })
      return
    }

    const backoff = Math.round(settings.sending.backoffBaseSeconds * 2 ** (attempts - 1))
    getDb().run(
      `UPDATE sends SET status = 'queued', attempts = ?, error = ?, send_after = ?, updated_at = ? WHERE id = ?`,
      attempts,
      message.slice(0, 500),
      addSeconds(new Date(), backoff).toISOString(),
      iso,
      job.send_id,
    )
    logger.warn(`engine: send ${job.send_id} failed (${message.slice(0, 120)}), retrying in ${backoff}s`)
  }

  /** Campaigns with no work left are closed out so the UI can show a final state. */
  private finalize(): number {
    const open = getDb().all<{ id: number; name: string }>(
      `SELECT c.id, c.name FROM campaigns c WHERE c.status = 'running'
        AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.campaign_id = c.id AND s.status IN ('queued','sending'))`,
    )
    let completed = 0
    for (const campaign of open) {
      const pending = getDb().count(`SELECT COUNT(*) FROM sends WHERE campaign_id = ? AND status = 'queued'`, campaign.id)
      if (pending) continue
      const iso = nowIso()
      getDb().run(`UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`, iso, iso, campaign.id)
      recordEvent({ kind: 'campaign.completed', campaignId: campaign.id, message: `Completed: ${campaign.name}`, meta: { campaignName: campaign.name } })
      completed += 1
    }
    return completed
  }

  /**
   * Drive the queue to empty right now — used by “send now” in the UI and by
   * tests. Rate limits are bypassed so a demo does not crawl at 30/min.
   */
  async drain({ maxRounds = 500, ignoreLimits = true }: { maxRounds?: number; ignoreLimits?: boolean } = {}): Promise<TickResult> {
    const total: TickResult = { processed: 0, sent: 0, failed: 0, skipped: 0, activated: 0, completed: 0, ms: 0 }
    for (let round = 0; round < maxRounds; round++) {
      // a tick may already be running (e.g. the "start" route nudged the worker):
      // wait for it instead of racing over it, otherwise the queue looks empty
      while (this.busy) await sleep(5)
      const result = await this.tick({ ignoreLimits })
      total.processed += result.processed
      total.sent += result.sent
      total.failed += result.failed
      total.skipped += result.skipped
      total.activated += result.activated
      total.completed += result.completed
      total.ms += result.ms
      if (result.processed > 0) continue
      const dueNow = getDb().count(`SELECT COUNT(*) FROM sends WHERE status = 'queued' AND send_after <= ?`, new Date(Date.now() + 50).toISOString())
      if (dueNow === 0) break
    }
    return total
  }
}

export const engine = new SendingEngine()
