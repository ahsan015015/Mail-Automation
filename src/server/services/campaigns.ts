import { getDb } from '../db/sqlite.js'
import { countSegment, recipientsForSegment } from './contacts.js'
import { getSettings } from './settings.js'
import { recordEvent } from './events.js'
import { addMinutes, bool, conflict, badRequest, jsonParse, nowIso, notFound, rate, round, toJson } from '../lib/util.js'
import { sanitizeEmailHtml, htmlToText } from '../lib/html.js'
import type {
  CampaignDto,
  CampaignSchedule,
  CampaignStats,
  CampaignStatus,
  CampaignTracking,
  CampaignType,
  Paged,
  Segment,
  SendDto,
  SendStatus,
  StepDto,
} from '../../shared/types.js'

/** Structure edits (steps added/removed/reordered, audience, schedule). */
export const EDITABLE: CampaignStatus[] = ['draft', 'scheduled', 'paused']
/** Content edits are also allowed while running: future drip emails can still be tweaked. */
export const LIVE_EDITABLE: CampaignStatus[] = [...EDITABLE, 'running']

interface CampaignRow {
  id: number
  name: string
  type: CampaignType
  status: CampaignStatus
  from_name: string
  from_email: string
  reply_to: string
  segment: string
  schedule: string
  tracking: string
  scheduled_start_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface StepRow {
  id: number
  campaign_id: number
  position: number
  name: string
  template_id: number | null
  subject: string
  preheader: string
  html: string
  text: string
  delay_minutes: number
  skip_if_opened: number
  skip_if_clicked: number
}

/* ── mappers ───────────────────────────────────────────────────────────────── */

const mapStep = (row: StepRow): StepDto => ({
  id: row.id,
  campaignId: row.campaign_id,
  position: row.position,
  name: row.name || `Email ${row.position + 1}`,
  templateId: row.template_id,
  subject: row.subject ?? '',
  preheader: row.preheader ?? '',
  html: row.html ?? '',
  text: row.text ?? '',
  delayMinutes: Number(row.delay_minutes ?? 0),
  skipIfOpened: bool(row.skip_if_opened),
  skipIfClicked: bool(row.skip_if_clicked),
})

function statsFor(campaignId: number): CampaignStats {
  const row = getDb().get<Record<string, number | string | null>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'queued'  THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS sending,
            SUM(CASE WHEN status = 'sent'    THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(open_count)  AS opens,
            SUM(CASE WHEN open_count  > 0 THEN 1 ELSE 0 END) AS unique_opens,
            SUM(click_count) AS clicks,
            SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) AS unique_clicks,
            MIN(CASE WHEN status = 'queued' THEN send_after END) AS next_send_at
     FROM sends WHERE campaign_id = ?`,
    campaignId,
  )
  const num = (key: string) => Number(row?.[key] ?? 0)
  const sent = num('sent')
  const delivered = sent
  const bounced = num('bounced')
  const unsubscribes = getDb().count(`SELECT COUNT(*) FROM events WHERE campaign_id = ? AND kind = 'contact.unsubscribed'`, campaignId)
  const terminal = sent + bounced + num('failed') + num('skipped')
  return {
    recipients: num('total'),
    queued: num('queued'),
    sending: num('sending'),
    sent,
    delivered,
    failed: num('failed'),
    bounced,
    skipped: num('skipped'),
    opens: num('opens'),
    uniqueOpens: num('unique_opens'),
    clicks: num('clicks'),
    uniqueClicks: num('unique_clicks'),
    unsubscribes,
    openRate: rate(num('unique_opens'), delivered),
    clickRate: rate(num('unique_clicks'), delivered),
    bounceRate: rate(bounced, sent + bounced),
    progress: num('total') ? round((terminal / num('total')) * 100, 1) : 0,
    nextSendAt: (row?.next_send_at as string) ?? null,
  }
}

function mapCampaign(row: CampaignRow, steps: StepRow[], stats: CampaignStats): CampaignDto {
  const segment = jsonParse<Segment>(row.segment, { listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] })
  const schedule = jsonParse<CampaignSchedule>(row.schedule, {
    startAt: row.scheduled_start_at,
    timezone: getSettings().sending.timezone,
    windowStartHour: null,
    windowEndHour: null,
    ratePerMinute: 30,
    dailyCap: 2000,
    skipWeekends: false,
  })
  const tracking = jsonParse<CampaignTracking>(row.tracking, { openTracking: true, clickTracking: true, includeUnsubscribe: true })
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    subject: steps.find((s) => s.position === 0)?.subject ?? steps[0]?.subject ?? '',
    segment,
    schedule: { ...schedule, startAt: row.scheduled_start_at },
    tracking,
    scheduledStartAt: row.scheduled_start_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recipientCount: stats.recipients || countSegment(segment),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps.map(mapStep),
    stats,
  }
}

const STEPS_FOR = `SELECT * FROM steps WHERE campaign_id = ? ORDER BY position`

export function getCampaign(id: number): CampaignDto {
  const row = getDb().get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id)
  if (!row) throw notFound('Campaign not found')
  return mapCampaign(row, getDb().all<StepRow>(STEPS_FOR, id), statsFor(id))
}

export function getCampaignRow(id: number): CampaignRow {
  const row = getDb().get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id)
  if (!row) throw notFound('Campaign not found')
  return row
}

export function listCampaigns(filter: { status?: CampaignStatus | 'all'; q?: string; page?: number; perPage?: number } = {}): Paged<CampaignDto> {
  const page = Math.max(1, Number(filter.page ?? 1) || 1)
  const perPage = Math.min(100, Math.max(5, Number(filter.perPage ?? 25) || 25))
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.status && filter.status !== 'all') {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  const q = (filter.q ?? '').trim().toLowerCase()
  if (q) {
    clauses.push('LOWER(name) LIKE ?')
    params.push(`%${q}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = getDb().count(`SELECT COUNT(*) FROM campaigns ${where}`, ...params)
  const rows = getDb().all<CampaignRow>(`SELECT * FROM campaigns ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage)
  const items = rows.map((row) => mapCampaign(row, getDb().all<StepRow>(STEPS_FOR, row.id), statsFor(row.id)))
  return { items, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

export function activeCampaigns(): CampaignRow[] {
  return getDb().all<CampaignRow>(`SELECT * FROM campaigns WHERE status IN ('running','scheduled') ORDER BY id`)
}

/* ── steps ─────────────────────────────────────────────────────────────────── */

export interface StepInput {
  id?: number
  position?: number
  name?: string
  templateId?: number | null
  subject?: string
  preheader?: string
  html?: string
  text?: string
  delayMinutes?: number
  skipIfOpened?: boolean
  skipIfClicked?: boolean
}

const stepContent = (input: StepInput) => {
  const html = sanitizeEmailHtml(input.html ?? '')
  return {
    html,
    text: (input.text ?? '').trim() || htmlToText(html),
  }
}

function upsertStep(campaignId: number, input: StepInput, position: number): void {
  const content = stepContent(input)
  const values = {
    position,
    name: (input.name ?? '').trim() || `Email ${position + 1}`,
    templateId: input.templateId ?? null,
    subject: (input.subject ?? '').trim(),
    preheader: (input.preheader ?? '').trim(),
    html: content.html,
    text: content.text,
    delayMinutes: Math.max(0, Math.floor(input.delayMinutes ?? 0)),
    skipIfOpened: Boolean(input.skipIfOpened),
    skipIfClicked: Boolean(input.skipIfClicked),
  }
  if (input.id) {
    const owned = getDb().get<{ id: number }>('SELECT id FROM steps WHERE id = ? AND campaign_id = ?', input.id, campaignId)
    if (owned) {
      getDb().run(
        `UPDATE steps SET position = ?, name = ?, template_id = ?, subject = ?, preheader = ?, html = ?, text = ?,
                delay_minutes = ?, skip_if_opened = ?, skip_if_clicked = ?, updated_at = ? WHERE id = ?`,
        values.position, values.name, values.templateId, values.subject, values.preheader, values.html, values.text,
        values.delayMinutes, values.skipIfOpened, values.skipIfClicked, nowIso(), input.id,
      )
      return
    }
  }
  getDb().run(
    `INSERT INTO steps (campaign_id, position, name, template_id, subject, preheader, html, text, delay_minutes,
                        skip_if_opened, skip_if_clicked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    campaignId, values.position, values.name, values.templateId, values.subject, values.preheader, values.html, values.text,
    values.delayMinutes, values.skipIfOpened, values.skipIfClicked, nowIso(), nowIso(),
  )
}

function replaceSteps(campaignId: number, steps: StepInput[]): void {
  const current = getDb().all<{ id: number }>('SELECT id FROM steps WHERE campaign_id = ?', campaignId)
  const keep = new Set(steps.filter((step) => step.id).map((step) => Number(step.id)))
  for (const row of current) {
    if (keep.has(row.id)) continue
    const alreadyTouched = getDb().count(`SELECT COUNT(*) FROM sends WHERE step_id = ? AND status <> 'queued'`, row.id)
    if (alreadyTouched) throw conflict('A step that already sent emails cannot be deleted — pause the campaign first')
    getDb().run('DELETE FROM steps WHERE id = ?', row.id)
  }
  // clear the unique (campaign_id, position) index first so reordered steps never collide
  current.forEach((row, index) => getDb().run('UPDATE steps SET position = ? WHERE id = ?', 1000 + index, row.id))
  steps.forEach((step, index) => upsertStep(campaignId, step, index))
}

export function addStep(campaignId: number, input: StepInput): StepDto {
  requireLiveEditable(campaignId)
  const position = getDb().count('SELECT COUNT(*) FROM steps WHERE campaign_id = ?', campaignId)
  getDb().transaction(() => upsertStep(campaignId, { ...input, id: undefined }, position))
  touch(campaignId)
  replanQueued(campaignId)
  const row = getDb().all<StepRow>(STEPS_FOR, campaignId).at(-1)!
  return mapStep(row)
}

export function updateStep(campaignId: number, stepId: number, patch: StepInput): StepDto {
  requireLiveEditable(campaignId)
  const row = getDb().get<StepRow>('SELECT * FROM steps WHERE id = ? AND campaign_id = ?', stepId, campaignId)
  if (!row) throw notFound('Step not found')
  getDb().transaction(() => upsertStep(campaignId, { ...mapStep(row), ...patch, id: stepId }, patch.position ?? row.position))
  touch(campaignId)
  replanQueued(campaignId)
  return mapStep(getDb().get<StepRow>('SELECT * FROM steps WHERE id = ?', stepId)!)
}

export function deleteStep(campaignId: number, stepId: number): void {
  requireEditable(campaignId)
  const sent = getDb().count(`SELECT COUNT(*) FROM sends WHERE step_id = ? AND status <> 'queued'`, stepId)
  if (sent) throw conflict('This step already sent emails, so it cannot be deleted')
  getDb().transaction(() => {
    getDb().run('DELETE FROM steps WHERE id = ? AND campaign_id = ?', stepId, campaignId)
    const remaining = getDb().all<{ id: number }>(`SELECT id FROM steps WHERE campaign_id = ? ORDER BY position`, campaignId)
    remaining.forEach((step, index) => getDb().run('UPDATE steps SET position = ? WHERE id = ?', index, step.id))
  })
  touch(campaignId)
  replanQueued(campaignId)
}

export function moveStep(campaignId: number, stepId: number, direction: 'up' | 'down'): void {
  requireEditable(campaignId)
  const steps = getDb().all<{ id: number; position: number }>('SELECT id, position FROM steps WHERE campaign_id = ? ORDER BY position', campaignId)
  const index = steps.findIndex((s) => s.id === stepId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= steps.length) return
  getDb().transaction(() => {
    const a = steps[index]!
    const b = steps[target]!
    getDb().run('UPDATE steps SET position = ? WHERE id = ?', b.position, a.id)
    getDb().run('UPDATE steps SET position = ? WHERE id = ?', a.position, b.id)
    // a stable swap may collide on the unique index → renumber sequentially
    const ordered = getDb().all<{ id: number }>('SELECT id FROM steps WHERE campaign_id = ? ORDER BY position, id', campaignId)
    ordered.forEach((row, i) => getDb().run('UPDATE steps SET position = ? WHERE id = ?', i, row.id))
  })
  touch(campaignId)
  replanQueued(campaignId)
}

/* ── campaign CRUD ─────────────────────────────────────────────────────────── */

export interface CampaignInput {
  name: string
  type?: CampaignType
  fromName?: string
  fromEmail?: string
  replyTo?: string
  segment?: Segment
  schedule?: Partial<CampaignSchedule>
  tracking?: Partial<CampaignTracking>
  scheduledStartAt?: string | null
  steps?: StepInput[]
}

function touch(id: number): void {
  getDb().run('UPDATE campaigns SET updated_at = ? WHERE id = ?', nowIso(), id)
}

function requireStatus(id: number, allowed: CampaignStatus[], what: string): CampaignRow {
  const row = getCampaignRow(id)
  if (!allowed.includes(row.status)) {
    throw conflict(`${labelOf(row.status)} campaigns are read-only — ${what}`)
  }
  return row
}

function requireEditable(id: number): CampaignRow {
  return requireStatus(id, EDITABLE, 'pause it first')
}

function requireLiveEditable(id: number): CampaignRow {
  return requireStatus(id, LIVE_EDITABLE, 'resume it to edit later emails')
}

const labelOf = (status: CampaignStatus) => ({ draft: 'Draft', scheduled: 'Scheduled', running: 'Running', paused: 'Paused', completed: 'Completed', canceled: 'Canceled' })[status]

export function createCampaign(input: CampaignInput): CampaignDto {
  const settings = getSettings()
  const name = input.name.trim()
  if (!name) throw badRequest('Campaign name is required')
  const type: CampaignType = input.type ?? 'broadcast'
  const now = nowIso()
  const segment = input.segment ?? { listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] as Segment['statuses'] }
  const schedule: CampaignSchedule = {
    startAt: input.scheduledStartAt ?? null,
    timezone: input.schedule?.timezone ?? settings.sending.timezone,
    windowStartHour: input.schedule?.windowStartHour ?? settings.sending.windowStartHour,
    windowEndHour: input.schedule?.windowEndHour ?? settings.sending.windowEndHour,
    ratePerMinute: input.schedule?.ratePerMinute ?? settings.sending.ratePerMinute,
    dailyCap: input.schedule?.dailyCap ?? settings.sending.dailyCap,
    skipWeekends: input.schedule?.skipWeekends ?? false,
  }
  const tracking: CampaignTracking = {
    openTracking: input.tracking?.openTracking ?? settings.tracking.openTracking,
    clickTracking: input.tracking?.clickTracking ?? settings.tracking.clickTracking,
    includeUnsubscribe: input.tracking?.includeUnsubscribe ?? settings.tracking.includeUnsubscribe,
  }

  const id = getDb().transaction(() => {
    const result = getDb().run(
      `INSERT INTO campaigns (name, type, status, from_name, from_email, reply_to, segment, schedule, tracking,
                              scheduled_start_at, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      name,
      type,
      input.fromName?.trim() || settings.fromName,
      input.fromEmail?.trim() || settings.fromEmail,
      input.replyTo?.trim() || settings.replyTo,
      toJson(segment),
      toJson(schedule),
      toJson(tracking),
      schedule.startAt ?? null,
      now,
      now,
    )
    const campaignId = result.lastInsertRowid
    const steps = input.steps?.length ? input.steps : [{ name: 'Email 1', delayMinutes: 0 }]
    steps.forEach((step, index) => upsertStep(campaignId, step, index))
    return campaignId
  })

  recordEvent({ kind: 'campaign.created', campaignId: id, message: `Draft “${name}” created`, meta: { campaignName: name } })
  return getCampaign(id)
}

export function updateCampaign(id: number, patch: Partial<CampaignInput>): CampaignDto {
  const current = getCampaignRow(id)
  requireEditable(id)
  const settings = getSettings()
  const baseSegment = jsonParse<Segment>(current.segment, { listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] })
  const baseTracking = jsonParse<CampaignTracking>(current.tracking, { openTracking: true, clickTracking: true, includeUnsubscribe: true })
  const baseSchedule = jsonParse<CampaignSchedule>(current.schedule, {
    startAt: current.scheduled_start_at,
    timezone: settings.sending.timezone,
    windowStartHour: settings.sending.windowStartHour,
    windowEndHour: settings.sending.windowEndHour,
    ratePerMinute: settings.sending.ratePerMinute,
    dailyCap: settings.sending.dailyCap,
    skipWeekends: false,
  })

  const segment: Segment = { ...baseSegment, ...(patch.segment ?? {}) }
  const tracking: CampaignTracking = { ...baseTracking, ...(patch.tracking ?? {}) }
  const schedule: CampaignSchedule = { ...baseSchedule, ...(patch.schedule ?? {}) }
  if (patch.scheduledStartAt !== undefined) schedule.startAt = patch.scheduledStartAt

  getDb().transaction(() => {
    getDb().run(
      `UPDATE campaigns SET name = ?, type = ?, from_name = ?, from_email = ?, reply_to = ?, segment = ?, schedule = ?,
              tracking = ?, scheduled_start_at = ?, updated_at = ? WHERE id = ?`,
      patch.name?.trim() || current.name,
      patch.type ?? current.type,
      patch.fromName?.trim() || current.from_name || settings.fromName,
      patch.fromEmail?.trim() || current.from_email || settings.fromEmail,
      patch.replyTo !== undefined ? patch.replyTo.trim() : current.reply_to,
      toJson(segment),
      toJson(schedule),
      toJson(tracking),
      schedule.startAt ?? null,
      nowIso(),
      id,
    )
    if (patch.steps?.length) replaceSteps(id, patch.steps)
  })

  if (current.status === 'scheduled' || current.status === 'paused') {
    replanQueued(id, schedule.startAt && !Number.isNaN(new Date(schedule.startAt).getTime()) ? new Date(schedule.startAt) : undefined)
  }
  return getCampaign(id)
}

export function deleteCampaign(id: number): void {
  const row = getCampaignRow(id)
  if (row.status === 'running') throw conflict('Cancel the campaign before deleting it')
  getDb().run('DELETE FROM campaigns WHERE id = ?', id)
}

export function duplicateCampaign(id: number): CampaignDto {
  const source = getCampaign(id)
  const copy = createCampaign({
    name: `${source.name} copy`,
    type: source.type,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    replyTo: source.replyTo,
    segment: source.segment,
    schedule: { ...source.schedule, startAt: null },
    tracking: source.tracking,
    scheduledStartAt: null,
    steps: source.steps.map((step, index) => ({
      name: step.name,
      subject: step.subject,
      preheader: step.preheader,
      html: step.html,
      text: step.text,
      delayMinutes: step.delayMinutes,
      skipIfOpened: step.skipIfOpened,
      skipIfClicked: step.skipIfClicked,
      position: index,
    })),
  })
  return copy
}

/* ── lifecycle ─────────────────────────────────────────────────────────────── */

export function validateReady(campaign: CampaignDto): string[] {
  const problems: string[] = []
  if (!campaign.steps.length) problems.push('Add at least one email step')
  campaign.steps.forEach((step, index) => {
    if (!step.subject.trim()) problems.push(`Step ${index + 1} has no subject line`)
    if (!step.html.trim() && !step.text.trim()) problems.push(`Step ${index + 1} has no body content`)
  })
  if (!campaign.fromEmail.trim()) problems.push('Set a sender email address')
  if (!campaign.recipientCount) problems.push('No recipients match the current audience filters')
  return problems
}

export function startCampaign(id: number, at?: string): CampaignDto {
  const campaign = getCampaign(id)
  if (campaign.status === 'running') return campaign
  if (['completed', 'canceled'].includes(campaign.status)) throw conflict('This campaign is finished and cannot be restarted')
  const problems = validateReady(campaign)
  if (problems.length) throw badRequest(problems[0]!, problems)

  const requested = at ? new Date(at) : campaign.scheduledStartAt ? new Date(campaign.scheduledStartAt) : new Date()
  const base = Number.isNaN(requested.getTime()) ? new Date() : requested
  const future = base.getTime() > Date.now() + 1000
  const now = nowIso()

  getDb().run(
    `UPDATE campaigns SET status = ?, scheduled_start_at = ?, started_at = ?, completed_at = NULL, updated_at = ? WHERE id = ?`,
    future ? 'scheduled' : 'running',
    base.toISOString(),
    future ? null : now,
    now,
    id,
  )
  const queued = enqueue(id, base)
  recordEvent({
    kind: 'campaign.started',
    campaignId: id,
    message: future ? `Scheduled — ${queued} message(s) queued for ${base.toISOString()}` : `Started — ${queued} message(s) queued`,
    meta: { queued, scheduled: future, campaignName: campaign.name },
  })
  return getCampaign(id)
}

export function pauseCampaign(id: number): CampaignDto {
  const row = getCampaignRow(id)
  if (row.status !== 'running' && row.status !== 'scheduled') throw conflict('Only running or scheduled campaigns can be paused')
  getDb().run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', 'paused', nowIso(), id)
  recordEvent({ kind: 'campaign.paused', campaignId: id, message: 'Paused', meta: { campaignName: row.name } })
  return getCampaign(id)
}

export function resumeCampaign(id: number): CampaignDto {
  const row = getCampaignRow(id)
  if (row.status !== 'paused') throw conflict('Only paused campaigns can be resumed')
  const base = row.scheduled_start_at && new Date(row.scheduled_start_at) > new Date() ? new Date(row.scheduled_start_at) : new Date()
  getDb().run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', base > new Date() ? 'scheduled' : 'running', nowIso(), id)
  enqueue(id, base)
  recordEvent({ kind: 'campaign.resumed', campaignId: id, message: 'Resumed', meta: { campaignName: row.name } })
  return getCampaign(id)
}

export function cancelCampaign(id: number): CampaignDto {
  const row = getCampaignRow(id)
  if (['completed', 'canceled'].includes(row.status)) return getCampaign(id)
  const now = nowIso()
  getDb().transaction(() => {
    getDb().run(`UPDATE sends SET status = 'skipped', error = 'campaign canceled', updated_at = ? WHERE campaign_id = ? AND status IN ('queued','sending')`, now, id)
    getDb().run(`UPDATE campaigns SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?`, now, now, id)
  })
  recordEvent({ kind: 'campaign.canceled', campaignId: id, message: 'Canceled — remaining messages skipped', meta: { campaignName: row.name } })
  return getCampaign(id)
}

/** Bring a finished campaign back to life (used by “retry failed”). */
export function reopenCampaign(id: number): void {
  const row = getCampaignRow(id)
  if (row.status === 'running' || row.status === 'scheduled') return
  const queued = getDb().count(`SELECT COUNT(*) FROM sends WHERE campaign_id = ? AND status = 'queued'`, id)
  if (!queued) throw badRequest('Nothing left to send for this campaign')
  const now = nowIso()
  getDb().run(`UPDATE campaigns SET status = 'running', completed_at = NULL, updated_at = ? WHERE id = ?`, now, now, id)
  recordEvent({ kind: 'campaign.resumed', campaignId: id, message: `Reopened for ${queued} retry(s)`, meta: { campaignName: row.name } })
}

export function completeCampaign(id: number): void {
  const now = nowIso()
  getDb().run(`UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status <> 'completed'`, now, now, id)
}

/**
 * Create one `sends` row per (step, recipient). Idempotent thanks to the
 * UNIQUE(step_id, contact_id) index, so resuming/replanning never duplicates.
 */
export function enqueue(campaignId: number, base: Date = new Date()): number {
  const campaign = getCampaignRow(campaignId)
  const segment = jsonParse<Segment>(campaign.segment, { listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] })
  const recipients = recipientsForSegment(segment)
  const steps = getDb().all<StepRow>(STEPS_FOR, campaignId)
  if (!steps.length || !recipients.length) return 0

  let inserted = 0
  getDb().transaction(() => {
    let cumulative = 0
    for (const step of steps) {
      cumulative += Number(step.delay_minutes || 0)
      const sendAfter = addMinutes(base, cumulative).toISOString()
      for (const recipient of recipients) {
        const result = getDb().run(
          `INSERT INTO sends (campaign_id, step_id, contact_id, to_email, subject, status, attempts, send_after, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
           ON CONFLICT (step_id, contact_id) DO NOTHING`,
          campaignId,
          step.id,
          recipient.id,
          recipient.email,
          step.subject,
          sendAfter,
          nowIso(),
          nowIso(),
        )
        inserted += result.changes
      }
    }
  })
  return inserted
}

/** Recompute `send_after` for messages that have not been sent yet. */
export function replanQueued(campaignId: number, baseOverride?: Date): void {
  const campaign = getCampaignRow(campaignId)
  const base = baseOverride ?? (campaign.scheduled_start_at ? new Date(campaign.scheduled_start_at) : campaign.started_at ? new Date(campaign.started_at) : new Date())
  const steps = getDb().all<StepRow>(STEPS_FOR, campaignId)
  let cumulative = 0
  for (const step of steps) {
    cumulative += Number(step.delay_minutes || 0)
    const sendAfter = addMinutes(base, cumulative).toISOString()
    getDb().run(`UPDATE sends SET send_after = ?, subject = (SELECT subject FROM steps WHERE id = sends.step_id), updated_at = ? WHERE step_id = ? AND status = 'queued'`, sendAfter, nowIso(), step.id)
  }
  // recipients added to the audience since the campaign started
  if (['running', 'scheduled', 'paused'].includes(campaign.status)) enqueue(campaignId, base)
}

export function estimateAudience(segment: Segment | undefined): { recipients: number; sample: { id: number; email: string; name: string }[] } {
  const recipients = countSegment(segment)
  const sample = recipientsForSegment(segment, 5).map((row) => ({ id: row.id, email: row.email, name: row.name }))
  return { recipients, sample }
}

/* ── sends (queue + delivery records) ────────────────────────────────────────── */

interface SendRow {
  id: number
  campaign_id: number
  campaign_name?: string
  step_id: number | null
  step_name?: string
  contact_id: number | null
  to_email: string
  subject: string
  status: SendStatus
  attempts: number
  error: string | null
  message_id: string | null
  transport: string | null
  send_after: string
  sent_at: string | null
  opened_at: string | null
  clicked_at: string | null
  open_count: number
  click_count: number
}

const mapSend = (row: SendRow): SendDto => ({
  id: row.id,
  campaignId: row.campaign_id,
  campaignName: row.campaign_name,
  stepId: row.step_id,
  stepName: row.step_name,
  contactId: row.contact_id,
  contactEmail: row.to_email,
  subject: row.subject,
  status: row.status,
  attempts: Number(row.attempts ?? 0),
  error: row.error ?? null,
  messageId: row.message_id,
  transport: row.transport,
  sendAfter: row.send_after,
  sentAt: row.sent_at,
  openedAt: row.opened_at,
  clickedAt: row.clicked_at,
  openCount: Number(row.open_count ?? 0),
  clickCount: Number(row.click_count ?? 0),
})

export function listSends(filter: { campaignId?: number; status?: SendStatus | 'all'; stepId?: number; q?: string; page?: number; perPage?: number } = {}): Paged<SendDto> {
  const page = Math.max(1, Number(filter.page ?? 1) || 1)
  const perPage = Math.min(200, Math.max(5, Number(filter.perPage ?? 25) || 25))
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.campaignId) {
    clauses.push('s.campaign_id = ?')
    params.push(filter.campaignId)
  }
  if (filter.stepId) {
    clauses.push('s.step_id = ?')
    params.push(filter.stepId)
  }
  if (filter.status && filter.status !== 'all') {
    clauses.push('s.status = ?')
    params.push(filter.status)
  }
  const q = (filter.q ?? '').trim().toLowerCase()
  if (q) {
    clauses.push('LOWER(s.to_email) LIKE ?')
    params.push(`%${q}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = getDb().count(`SELECT COUNT(*) FROM sends s ${where}`, ...params)
  const rows = getDb().all<SendRow>(
    `SELECT s.*, c.name AS campaign_name, st.name AS step_name
     FROM sends s LEFT JOIN campaigns c ON c.id = s.campaign_id LEFT JOIN steps st ON st.id = s.step_id
     ${where} ORDER BY s.send_after DESC, s.id DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage,
  )
  return { items: rows.map(mapSend), total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) }
}

export function getSend(id: number) {
  const row = getDb().get<SendRow>('SELECT * FROM sends WHERE id = ?', id)
  return row ? mapSend(row) : null
}

export function retryFailed(campaignId: number): number {
  const now = nowIso()
  const result = getDb().run(
    `UPDATE sends SET status = 'queued', attempts = 0, error = NULL, send_after = ?, updated_at = ?
     WHERE campaign_id = ? AND status IN ('failed','bounced')`,
    now,
    now,
    campaignId,
  )
  return result.changes
}

export function campaignStats(id: number): CampaignStats {
  return statsFor(id)
}
