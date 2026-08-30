import { config } from '../lib/config.js'
import { baseUrl } from '../lib/http.js'
import type { Request } from 'express'
import { deliver } from './mailer.js'
import { renderMessage } from './render.js'
import { saveMessage } from './mailbox.js'
import { recordEvent } from './events.js'
import { getSettings } from './settings.js'
import { findContactByEmail } from './contacts.js'
import { badRequest } from '../lib/util.js'
import type { CampaignTracking } from '../../shared/types.js'

export interface TestSendInput {
  to: string
  subject: string
  preheader?: string
  html: string
  text?: string
  campaignName?: string
  campaignId?: number | null
  fromName?: string
  fromEmail?: string
  replyTo?: string
  tracking?: Partial<CampaignTracking>
}

/**
 * Render + deliver a single preview message. Uses the recipient's real contact
 * record when one exists, so merge tags resolve exactly as they will in the
 * campaign, but never creates tracking rows (`sendId: 0`, track disabled).
 */
export async function sendTest(input: TestSendInput, req?: Request) {
  const settings = getSettings()
  if (!input.to) throw badRequest('A recipient email is required')
  const fromEmail = (input.fromEmail || settings.fromEmail).trim()
  if (!fromEmail) throw badRequest('Set a sender email address in Settings first')

  const contact = findContactByEmail(input.to)
  const tracking: CampaignTracking = {
    openTracking: false,
    clickTracking: false,
    includeUnsubscribe: input.tracking?.includeUnsubscribe ?? true,
  }
  const rendered = renderMessage({
    campaign: {
      id: input.campaignId ?? 0,
      name: input.campaignName ?? 'Test send',
      fromName: input.fromName || settings.fromName,
      fromEmail,
      replyTo: input.replyTo ?? settings.replyTo,
      tracking,
    },
    step: { subject: input.subject, preheader: input.preheader ?? '', html: input.html, text: input.text ?? '' },
    contact: contact ? { id: contact.id, email: contact.email, name: contact.name, fields: contact.fields } : { email: input.to },
    sendId: 0,
    baseUrl: req ? baseUrl(req) : config.publicBaseUrl || `http://127.0.0.1:${config.port}`,
    settings,
    track: false,
  })

  const info = await deliver(
    {
      to: { address: input.to, name: contact?.name || undefined },
      from: { address: fromEmail, name: rendered.fromName },
      replyTo: rendered.replyTo || undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: { ...rendered.headers, 'X-Mail-Automation-Test': '1' },
      messageId: rendered.messageId,
    },
    settings,
  )

  let mailboxId: number | null = null
  if (info.transport === 'memory') {
    const saved = saveMessage({
      toEmail: input.to,
      toName: contact?.name ?? '',
      fromEmail,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      subject: `${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
      messageId: info.messageId,
      campaignId: input.campaignId ?? null,
      raw: info.raw,
    })
    mailboxId = saved.id
  }

  recordEvent({
    kind: 'test.sent',
    campaignId: input.campaignId ?? null,
    contactId: contact?.id ?? null,
    message: `Test “${rendered.subject}” → ${input.to} (${info.transport})`,
    meta: { email: input.to, transport: info.transport },
  })

  return { ok: true, transport: info.transport, messageId: info.messageId, mailboxId, subject: rendered.subject }
}
