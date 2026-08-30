import crypto from 'node:crypto'
import { render } from '../lib/merge.js'
import { buildUnsubscribeBlock, escapeHtml, htmlToText, injectOpenPixel, rewriteLinks } from '../lib/html.js'
import { signToken } from '../lib/tokens.js'
import type { MergeContact } from '../lib/merge.js'
import type { ResolvedSettings } from './settings.js'

export interface RenderInput {
  campaign: {
    id: number
    name: string
    fromName: string
    fromEmail: string
    replyTo: string
    tracking: { openTracking: boolean; clickTracking: boolean; includeUnsubscribe: boolean }
  }
  step: { subject: string; preheader: string; html: string; text: string }
  contact: MergeContact
  sendId: number
  baseUrl: string
  settings: ResolvedSettings
  /** test sends must not pollute tracking stats */
  track?: boolean
}

export interface RenderedMessage {
  subject: string
  preheader: string
  html: string
  text: string
  headers: Record<string, string>
  messageId: string
  fromName: string
  fromEmail: string
  replyTo: string
  unsubscribeUrl: string
  openUrl: string | null
}

const domainOf = (email: string, fallback = 'maillocal.dev') => {
  const domain = String(email || '').split('@')[1]
  return domain && domain.includes('.') ? domain : fallback
}

export function newMessageId(fromEmail: string): string {
  return `${Date.now().toString(36)}.${crypto.randomBytes(6).toString('hex')}@${domainOf(fromEmail)}`
}

/**
 * Personalise + instrument a single message. Everything that depends on the
 * recipient (merge tags, unsubscribe URL, tracking pixel, rewritten links) is
 * computed here so the engine only deals with delivery.
 */
export function renderMessage(input: RenderInput): RenderedMessage {
  const { campaign, step, contact, sendId, baseUrl, settings } = input
  const track = input.track !== false && Boolean(contact.id)
  const fromName = campaign.fromName || settings.fromName
  const fromEmail = campaign.fromEmail || settings.fromEmail
  const replyTo = campaign.replyTo || settings.replyTo

  const unsubscribeUrl = contact.id ? `${baseUrl}/t/u/${signToken({ k: 'u', i: contact.id, cid: campaign.id })}` : ''
  const ctx = { contact, campaign: { name: campaign.name }, unsubscribeUrl }

  const subject = oneLine(render(step.subject || `${campaign.name}`, ctx))
  const preheader = oneLine(render(step.preheader, ctx))

  let html = render(step.html, ctx)
  let text = step.text.trim() ? render(step.text, ctx) : htmlToTextSafe(html)

  // Authors who placed {{ unsubscribe_url }} themselves keep full control of the footer.
  const ownsUnsubscribe = /\{\{\s*unsubscribe_url\s*\}\}/i.test(step.html)
  if (campaign.tracking.includeUnsubscribe && unsubscribeUrl && !ownsUnsubscribe) {
    html = `${html}${footerHtml({ fromName, campaignName: campaign.name, unsubscribeUrl, email: contact.email })}`
  }
  if (unsubscribeUrl && !/\{\{\s*unsubscribe_url\s*\}\}/i.test(step.text)) {
    text = `${text}\n\n—\n${fromName} · ${campaign.name}\nUnsubscribe: ${unsubscribeUrl}`
  }
  if (preheader) html = ensurePreheader(html, preheader)

  const openTracking = track && campaign.tracking.openTracking && settings.tracking.openTracking
  const clickTracking = track && campaign.tracking.clickTracking && settings.tracking.clickTracking
  const openUrl = openTracking ? `${baseUrl}/t/o/${signToken({ k: 'o', i: sendId, cid: campaign.id })}` : null
  const clickUrl = clickTracking ? `${baseUrl}/t/c/${signToken({ k: 'c', i: sendId, cid: campaign.id })}` : null

  if (clickUrl) html = rewriteLinks(html, clickUrl, baseUrl)
  if (openUrl) html = injectOpenPixel(html, openUrl)

  const headers: Record<string, string> = {
    'X-Campaign': String(campaign.id),
    'X-Campaign-Name': subjectSafe(campaign.name),
    'Auto-Submitted': 'auto-generated',
    'X-Mailer': 'Mail-Automation',
  }
  if (unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  if (openUrl) headers['X-Open-Beacon'] = '1'
  if (track) headers['X-Send-Id'] = String(sendId)

  return {
    subject,
    preheader,
    html: wrapHtml({ html, text, preheader, subject }),
    text,
    headers,
    messageId: newMessageId(fromEmail),
    fromName,
    fromEmail,
    replyTo,
    unsubscribeUrl,
    openUrl,
  }
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

const oneLine = (value: string) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
const subjectSafe = (value: string) => String(value ?? '').replace(/[\r\n"]/g, ' ').slice(0, 160)

function htmlToTextSafe(html: string): string {
  return htmlToText(html)
}

function ensurePreheader(html: string, preheader: string): string {
  const clean = escapeHtml(preheader).slice(0, 200)
  const block = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent" aria-hidden="true">${clean}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>`
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, (match) => `${match}${block}`)
  return `${block}${html}`
}

function footerHtml(args: { fromName: string; campaignName: string; unsubscribeUrl: string; email: string }): string {
  const year = new Date().getFullYear()
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #e2e8f0">
      <tr><td style="padding:16px 0 0;font-size:12px;line-height:1.6;color:#64748b">
        You receive ${escapeHtml(args.campaignName)} because ${escapeHtml(args.email)} is on the ${escapeHtml(args.fromName)} list.<br />
        ${buildUnsubscribeBlock(args.unsubscribeUrl, 'Unsubscribe')}
        <div style="margin-top:6px;color:#94a3b8">© ${year} ${escapeHtml(args.fromName)}</div>
      </td></tr>
    </table>`
}

/** Minimal document wrapper — templates that already ship <html> are left alone. */
function wrapHtml(args: { html: string; text: string; preheader: string; subject: string }): string {
  const { html } = args
  if (!html.trim()) return `<html><body><p>${escapeHtml(args.text)}</p></body></html>`
  if (/<html[\s>]/i.test(html)) return html
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-preheader" content="${escapeHtml(args.preheader)}" />
    <title>${escapeHtml(args.subject)}</title>
    <style>
      body { margin:0; padding:0; background:#f1f5f9; color:#0f172a;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
      a { color:#4f46e5; }
      .wrap { max-width:600px; margin:0 auto; padding:28px 20px; }
      .card { background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:28px; }
      img { max-width:100%; }
      @media (max-width:640px){ .card { padding:20px !important; border-radius:0 !important; } }
    </style>
  </head>
  <body>
    <div class="wrap"><div class="card">${html}</div></div>
  </body>
</html>`
}
