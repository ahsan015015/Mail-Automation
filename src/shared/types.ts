/**
 * Types shared by the Express server and the React client.
 * Keep this file dependency-free: it is imported on both sides of the wire.
 */

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

/* ── Audiences ─────────────────────────────────────────────────────────────── */

export type ContactStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained' | 'pending'

export interface ListDto {
  id: number
  name: string
  description: string
  archived: boolean
  contactCount: number
  subscribedCount: number
  unsubscribeCount: number
  subscribeToken: string
  createdAt: string
}

export interface TagDto {
  id: number
  name: string
  color: string
  contactCount: number
}

export interface ContactDto {
  id: number
  email: string
  name: string
  fields: Record<string, string>
  status: ContactStatus
  tags: TagDto[]
  lists: Pick<ListDto, 'id' | 'name'>[]
  sentCount: number
  openCount: number
  clickCount: number
  lastOpenAt: string | null
  lastClickAt: string | null
  unsubscribedAt: string | null
  createdAt: string
  updatedAt: string
}

/** who a campaign sends to. Empty arrays mean "no filter on that dimension". */
export interface Segment {
  listIds: number[]
  tagIds: number[]
  tagMatch: 'any' | 'all'
  excludeListIds: number[]
  excludeTagIds: number[]
  statuses: ContactStatus[]
}

export const emptySegment = (): Segment => ({
  listIds: [],
  tagIds: [],
  tagMatch: 'any',
  excludeListIds: [],
  excludeTagIds: [],
  statuses: ['subscribed'],
})

/* ── Content ───────────────────────────────────────────────────────────────── */

export interface TemplateDto {
  id: number
  name: string
  subject: string
  preheader: string
  html: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface StepDto {
  id: number
  campaignId: number
  position: number
  name: string
  templateId: number | null
  subject: string
  preheader: string
  html: string
  text: string
  delayMinutes: number
  skipIfOpened: boolean
  skipIfClicked: boolean
}

/* ── Campaigns ───────────────────────────────────────────────────────────────── */

export type CampaignType = 'broadcast' | 'sequence'
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'canceled'

export interface CampaignSchedule {
  /** ISO string. Null → start as soon as the campaign is started. */
  startAt: string | null
  timezone: string
  /** Only send inside this local hour window, e.g. 9 → 18. */
  windowStartHour: number | null
  windowEndHour: number | null
  ratePerMinute: number
  dailyCap: number
  skipWeekends: boolean
}

export interface CampaignTracking {
  openTracking: boolean
  clickTracking: boolean
  includeUnsubscribe: boolean
}

export interface CampaignDto {
  id: number
  name: string
  type: CampaignType
  status: CampaignStatus
  fromName: string
  fromEmail: string
  replyTo: string
  subject: string
  segment: Segment
  schedule: CampaignSchedule
  tracking: CampaignTracking
  scheduledStartAt: string | null
  startedAt: string | null
  completedAt: string | null
  recipientCount: number
  createdAt: string
  updatedAt: string
  steps: StepDto[]
  stats: CampaignStats
}

export interface CampaignStats {
  recipients: number
  queued: number
  sending: number
  sent: number
  delivered: number
  failed: number
  bounced: number
  skipped: number
  opens: number
  uniqueOpens: number
  clicks: number
  uniqueClicks: number
  unsubscribes: number
  openRate: number
  clickRate: number
  bounceRate: number
  progress: number
  nextSendAt: string | null
}

export const EMPTY_STATS: CampaignStats = {
  recipients: 0,
  queued: 0,
  sending: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  bounced: 0,
  skipped: 0,
  opens: 0,
  uniqueOpens: 0,
  clicks: 0,
  uniqueClicks: 0,
  unsubscribes: 0,
  openRate: 0,
  clickRate: 0,
  bounceRate: 0,
  progress: 0,
  nextSendAt: null,
}

export type SendStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced' | 'skipped'

export interface SendDto {
  id: number
  campaignId: number
  campaignName?: string
  stepId: number | null
  stepName?: string
  contactId: number | null
  contactEmail: string
  subject: string
  status: SendStatus
  attempts: number
  error: string | null
  messageId: string | null
  transport: string | null
  sendAfter: string
  sentAt: string | null
  openedAt: string | null
  clickedAt: string | null
  openCount: number
  clickCount: number
}

/* ── Activity ────────────────────────────────────────────────────────────────── */

export type EventKind =
  | 'campaign.created'
  | 'campaign.started'
  | 'campaign.completed'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.canceled'
  | 'send.queued'
  | 'send.sent'
  | 'send.failed'
  | 'send.bounced'
  | 'send.skipped'
  | 'contact.opened'
  | 'contact.clicked'
  | 'contact.unsubscribed'
  | 'contact.subscribed'
  | 'contact.bounced'
  | 'contact.complained'
  | 'contact.imported'
  | 'test.sent'

export interface EventDto {
  id: number
  kind: EventKind
  campaignId: number | null
  campaignName: string | null
  contactId: number | null
  contactEmail: string | null
  sendId: number | null
  message: string
  meta: Record<string, unknown>
  createdAt: string
}

/* ── Inbox (local mail catcher) ───────────────────────────────────────────────── */

export interface MailboxMessageDto {
  id: number
  toEmail: string
  toName: string
  fromEmail: string
  fromName: string
  replyTo: string
  subject: string
  html: string
  text: string
  headers: Record<string, string>
  messageId: string | null
  sendId: number | null
  campaignId: number | null
  emlPath: string | null
  simulatedOpenAt: string | null
  createdAt: string
}

/* ── Import + funnel ──────────────────────────────────────────────────────────── */

export interface ImportResult {
  created: number
  updated: number
  skipped: { line: number; reason: string }[]
  total: number
  tagsCreated: number
  columns: string[]
}

export interface FunnelPoint {
  label: string
  value: number
  percent: number
}

/* ── Settings ─────────────────────────────────────────────────────────────────── */

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  /** Never returned by the API — `hasPassword` is sent instead. */
  password: string
  pool: number
  maxMessages: number
}

export interface WorkspaceSettings {
  workspaceName: string
  fromName: string
  fromEmail: string
  replyTo: string
  transport: 'auto' | 'smtp' | 'memory'
  smtp: Omit<SmtpSettings, 'password'> & { password?: string; hasPassword: boolean }
  sending: {
    ratePerMinute: number
    dailyCap: number
    maxAttempts: number
    backoffBaseSeconds: number
    windowStartHour: number | null
    windowEndHour: number | null
    timezone: string
  }
  tracking: {
    openTracking: boolean
    clickTracking: boolean
    includeUnsubscribe: boolean
    trackDomain: string
  }
}

/* ── Dashboard ────────────────────────────────────────────────────────────────── */

export interface DashboardDto {
  totals: {
    contacts: number
    subscribed: number
    unsubscribed: number
    bounced: number
    lists: number
    templates: number
    campaignsRunning: number
    campaignsScheduled: number
    queued: number
    sentToday: number
    sent: number
    opens: number
    clicks: number
    openRate: number
    clickRate: number
  }
  series: { hour: string; sent: number; opens: number; clicks: number }[]
  topCampaigns: {
    id: number
    name: string
    status: CampaignStatus
    sent: number
    recipients: number
    openRate: number
    clickRate: number
  }[]
  recentEvents: EventDto[]
  engine: {
    running: boolean
    tickMs: number
    queueDepth: number
    lastTickAt: string | null
    tickDurationMs: number | null
    transport: 'smtp' | 'memory'
    activeCampaigns: number
  }
}

/* ── Auth ─────────────────────────────────────────────────────────────────────── */

export interface UserDto {
  id: number
  email: string
  name: string
  role: 'owner' | 'member'
  createdAt: string
}

/* ── Shared helpers ───────────────────────────────────────────────────────────── */

export const MERGE_VARIABLES: { token: string; label: string; example: string }[] = [
  { token: 'first_name', label: 'First name', example: 'Ahsan' },
  { token: 'last_name', label: 'Last name', example: 'Rahman' },
  { token: 'full_name', label: 'Full name', example: 'Ahsan Rahman' },
  { token: 'email', label: 'Email address', example: 'ahsan@example.com' },
  { token: 'company', label: 'Company (custom field)', example: 'Northwind' },
  { token: 'unsubscribe_url', label: 'Unsubscribe link', example: 'https://…/t/u/…' },
  { token: 'campaign', label: 'Campaign name', example: 'Onboarding week 1' },
  { token: 'date', label: 'Today’s date', example: 'March 3, 2026' },
  { token: 'year', label: 'Year', example: '2026' },
]

export const STATUS_LABEL: Record<ContactStatus, string> = {
  subscribed: 'Subscribed',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  complained: 'Complained',
  pending: 'Pending',
}
