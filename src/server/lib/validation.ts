import { z } from 'zod'
import { EMAIL_RE } from './http.js'

const idList = z.array(z.number().int().positive())
const shortText = (max = 200) => z.string().trim().max(max)
const longText = () => z.string().max(200_000)
export const CONTACT_STATUSES = ['subscribed', 'unsubscribed', 'bounced', 'complained', 'pending'] as const

export const emailField = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(EMAIL_RE, 'Enter a valid email address')

/* ── auth ─────────────────────────────────────────────────────────────────── */

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required').max(200),
})

export const setupSchema = z.object({
  email: emailField,
  name: shortText(120).default(''),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
})

/* ── audience ─────────────────────────────────────────────────────────────── */

export const listSchema = z.object({
  name: shortText(120).min(1, 'List name is required'),
  description: shortText(500).default(''),
  archived: z.boolean().default(false),
})
export const listUpdateSchema = listSchema.partial()

export const tagSchema = z.object({
  name: shortText(60).min(1, 'Tag name is required'),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #6366f1')
    .default('#6366f1'),
})

export const segmentSchema = z.object({
  listIds: idList.default([]),
  tagIds: idList.default([]),
  tagMatch: z.enum(['any', 'all']).default('any'),
  excludeListIds: idList.default([]),
  excludeTagIds: idList.default([]),
  statuses: z.array(z.enum(CONTACT_STATUSES)).default(['subscribed']),
})

export const contactSchema = z.object({
  email: emailField,
  name: shortText(160).default(''),
  fields: z.record(z.string(), z.string()).default({}),
  status: z.enum(CONTACT_STATUSES).default('subscribed'),
  listIds: idList.default([]),
  tags: z.array(z.string().trim().min(1).max(60)).default([]),
})
export const contactUpdateSchema = contactSchema.partial()

export const contactQuerySchema = z.object({
  q: shortText(120).default(''),
  listId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  status: z.enum([...CONTACT_STATUSES, 'all']).default('subscribed'),
  sort: z.enum(['created_desc', 'created_asc', 'email_asc', 'email_desc', 'opened_desc']).default('created_desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(200).default(25),
})

export const importSchema = z.object({
  csv: z.string().min(1, 'Paste CSV content or upload a file'),
  listId: z.coerce.number().int().positive().optional(),
  defaultStatus: z.enum(CONTACT_STATUSES).default('subscribed'),
  duplicatePolicy: z.enum(['skip', 'update']).default('update'),
  tags: z.array(z.string().trim().min(1).max(60)).default([]),
  sendMail: z.boolean().default(false),
})

/* ── content ──────────────────────────────────────────────────────────────── */

export const templateSchema = z.object({
  name: shortText(120).min(1, 'Template name is required'),
  subject: shortText(300).default(''),
  preheader: shortText(300).default(''),
  html: longText().default(''),
  text: longText().default(''),
})
export const templateUpdateSchema = templateSchema.partial()

export const previewSchema = z.object({
  subject: shortText(300).default(''),
  preheader: shortText(300).default(''),
  html: longText().default(''),
  text: longText().default(''),
  sample: z.record(z.string(), z.string()).default({}),
})

/* ── campaigns ────────────────────────────────────────────────────────────── */

export const scheduleSchema = z.object({
  startAt: z.string().trim().max(40).nullable().default(null),
  timezone: shortText(64).default('UTC'),
  windowStartHour: z.number().int().min(0).max(23).nullable().default(null),
  windowEndHour: z.number().int().min(0).max(23).nullable().default(null),
  ratePerMinute: z.number().int().min(1).max(6000).default(30),
  dailyCap: z.number().int().min(1).max(1_000_000).default(2000),
  skipWeekends: z.boolean().default(false),
})

export const campaignTrackingSchema = z.object({
  openTracking: z.boolean().default(true),
  clickTracking: z.boolean().default(true),
  includeUnsubscribe: z.boolean().default(true),
})

export const stepSchema = z.object({
  position: z.number().int().min(0).max(50).optional(),
  name: shortText(120).default(''),
  templateId: z.number().int().positive().nullable().default(null),
  subject: shortText(300).default(''),
  preheader: shortText(300).default(''),
  html: longText().default(''),
  text: longText().default(''),
  delayMinutes: z.number().int().min(0).max(366 * 24 * 60).default(0),
  skipIfOpened: z.boolean().default(false),
  skipIfClicked: z.boolean().default(false),
})

export const campaignSchema = z.object({
  name: shortText(160).min(1, 'Campaign name is required'),
  type: z.enum(['broadcast', 'sequence']).default('broadcast'),
  fromName: shortText(160).default(''),
  fromEmail: emailField,
  replyTo: shortText(200).default(''),
  segment: segmentSchema.default({ listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }),
  schedule: scheduleSchema.default({
    startAt: null,
    timezone: 'UTC',
    windowStartHour: null,
    windowEndHour: null,
    ratePerMinute: 30,
    dailyCap: 2000,
    skipWeekends: false,
  }),
  tracking: campaignTrackingSchema.default({ openTracking: true, clickTracking: true, includeUnsubscribe: true }),
  scheduledStartAt: z.string().trim().max(40).nullable().default(null),
  steps: z.array(stepSchema).max(51).default([]),
})
export const campaignUpdateSchema = campaignSchema.partial()

export const startCampaignSchema = z.object({
  /** ISO instant to begin at. Omit to begin now. */
  at: z.string().trim().max(40).optional(),
})

export const testSendSchema = z.object({
  email: emailField,
  stepId: z.number().int().positive().optional(),
  contactEmail: emailField.optional(),
})

/* ── settings ─────────────────────────────────────────────────────────────── */

export const smtpSchema = z.object({
  host: shortText(200).default(''),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: shortText(200).default(''),
  password: z.string().max(500).default(''),
  pool: z.number().int().min(1).max(20).default(4),
  maxMessages: z.number().int().min(1).max(1000).default(50),
})

export const sendingSchema = z.object({
  ratePerMinute: z.number().int().min(1).max(6000).default(30),
  dailyCap: z.number().int().min(1).max(1_000_000).default(2000),
  maxAttempts: z.number().int().min(1).max(20).default(4),
  backoffBaseSeconds: z.number().int().min(1).max(86_400).default(30),
  windowStartHour: z.number().int().min(0).max(23).nullable().default(null),
  windowEndHour: z.number().int().min(0).max(23).nullable().default(null),
  timezone: shortText(64).default('UTC'),
})

export const trackingSettingsSchema = z.object({
  openTracking: z.boolean().default(true),
  clickTracking: z.boolean().default(true),
  includeUnsubscribe: z.boolean().default(true),
  trackDomain: shortText(200).default(''),
})

export const settingsSchema = z
  .object({
    workspaceName: shortText(120).optional(),
    fromName: shortText(160).optional(),
    fromEmail: emailField.optional(),
    replyTo: shortText(200).optional(),
    transport: z.enum(['auto', 'smtp', 'memory']).optional(),
    smtp: smtpSchema.partial().optional(),
    sending: sendingSchema.partial().optional(),
    tracking: trackingSettingsSchema.partial().optional(),
  })
  .superRefine((value, ctx) => {
    // switching to smtp without a host would silently stop all delivery
    if (value.transport === 'smtp' && !value.smtp?.host?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['smtp', 'host'], message: 'Set an SMTP host before switching the transport to smtp' })
    }
    const { windowStartHour, windowEndHour } = value.sending ?? {}
    if (windowStartHour !== null && windowEndHour !== null && windowStartHour !== undefined && windowEndHour !== undefined && windowStartHour === windowEndHour) {
      ctx.addIssue({ code: 'custom', path: ['sending', 'windowEndHour'], message: 'The sending window start and end hour must differ' })
    }
  })

/** Public list subscribe endpoint (double opt-in free, token gated). */
export const publicSubscribeSchema = z.object({
  email: emailField,
  name: shortText(160).default(''),
  fields: z.record(z.string(), z.string()).default({}),
})

/* ── helpers ──────────────────────────────────────────────────────────────── */

export function parseOr<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }))
    const error = new Error(details[0]?.message ?? 'Invalid request') as Error & { status?: number; details?: unknown }
    error.status = 422
    error.details = details
    throw error
  }
  return result.data
}
