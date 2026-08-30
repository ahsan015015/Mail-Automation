import { Router, type Request } from 'express'
import { readToken } from '../lib/tokens.js'
import { getDb } from '../db/sqlite.js'
import { bus, recordEvent } from '../services/events.js'
import { getContact, subscribe, unsubscribe } from '../services/contacts.js'
import { getListByToken } from '../services/lists.js'
import { page } from '../lib/page.js'
import { getClientIp } from '../lib/http.js'
import { escapeHtml } from '../lib/html.js'
import { badRequest, nowIso } from '../lib/util.js'
import { parseOr, publicSubscribeSchema } from '../lib/validation.js'

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

interface SendRow {
  id: number
  campaign_id: number | null
  contact_id: number | null
  opened_at: string | null
  clicked_at: string | null
  to_email: string
}

const campaignName = (id: number | null): string | null => (id ? (getDb().get<{ name: string }>('SELECT name FROM campaigns WHERE id = ?', id)?.name ?? null) : null)

const deviceOf = (req: Request) => ({ ip: getClientIp(req), ua: String(req.headers['user-agent'] ?? '').slice(0, 200) })

const oneClickHeader = (req: Request) => String(req.headers['list-unsubscribe-post'] ?? '') === 'List-Unsubscribe=One-Click'

function contactOrNull(id: number) {
  try {
    return getContact(id)
  } catch {
    return null
  }
}

/**
 * Recipient-facing endpoints. They are public by nature, so every handler is
 * defensive: a bad/expired token must render a friendly page, never a 500.
 */
export function trackingRouter(): Router {
  const router = Router()

  router.get('/o/:token', (req, res) => {
    res.setHeader('Content-Type', 'image/gif')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    const payload = readToken(String(req.params.token ?? ''))
    if (payload?.k === 'o') {
      try {
        recordOpen(payload.i, payload.cid ?? null, req)
      } catch (error) {
        console.debug('[tracking] open ignored:', error instanceof Error ? error.message : error)
      }
    }
    res.end(PIXEL)
  })

  router.get('/c/:token', (req, res) => {
    const payload = readToken(String(req.params.token ?? ''))
    const target = String(req.query.u ?? '')
    const safe = /^https?:\/\/[^\s]+$/i.test(target) && !/\/t\/(o|c|u|p)\//.test(target)
    if (!payload || payload.k !== 'c' || !safe) {
      res
        .status(400)
        .type('html')
        .send(
          page({
            title: 'Link no longer works',
            heading: 'This link has expired or was altered',
            tone: 'warn',
            body: '<p>Tracking links are signed and tied to one message. Use the link from a recent email, or reply to the sender if you need help.</p>',
          }),
        )
      return
    }
    try {
      recordClick(payload.i, payload.cid ?? null, target, req)
    } catch (error) {
      console.debug('[tracking] click ignored:', error instanceof Error ? error.message : error)
    }
    res.redirect(302, target)
  })

  const doUnsubscribe = (token: string, req: Request) => {
    const payload = readToken(token)
    if (!payload || payload.k !== 'u') return null
    const contact = contactOrNull(payload.i)
    if (!contact) return null
    const already = contact.status === 'unsubscribed'
    if (!already || oneClickHeader(req)) unsubscribe(contact.id, 'unsubscribe link')
    const name = campaignName(payload.cid ?? null)
    recordEvent({
      kind: 'contact.unsubscribed',
      campaignId: payload.cid ?? null,
      contactId: contact.id,
      message: `${already ? 'Already unsubscribed' : 'Unsubscribed'}: ${contact.email}`,
      meta: { email: contact.email, source: 'link', campaignName: name, ...deviceOf(req) },
    })
    if (!already) bus.publish('contact', { id: contact.id, email: contact.email, status: 'unsubscribed' })
    return { contact, already, campaignName: name }
  }

  router.get('/u/:token', (req, res) => {
    const token = String(req.params.token ?? '')
    // RFC 8058 one-click: mail providers POST (or GET) without user interaction
    if (oneClickHeader(req)) {
      const result = doUnsubscribe(token, req)
      res.type('text/plain').status(result ? 200 : 404).send(result ? 'List-Unsubscribe=One-Click' : 'invalid link')
      return
    }
    const payload = readToken(token)
    const contact = payload?.k === 'u' ? contactOrNull(payload.i) : null
    if (!contact) {
      res
        .status(404)
        .type('html')
        .send(
          page({
            title: 'Unsubscribe',
            heading: 'This link has expired',
            tone: 'warn',
            body: '<p>Open the link from a recent email, or reply to the sender to manage your preferences.</p>',
          }),
        )
      return
    }
    if (contact.status === 'unsubscribed') {
      res
        .type('html')
        .send(
          page({
            title: 'Unsubscribed',
            heading: 'You are already unsubscribed',
            tone: 'ok',
            body: `<p><strong>${escapeHtml(contact.email)}</strong> will not receive further emails.</p>`,
            actions: [{ label: 'Change my mind — manage preferences', href: `/t/p/${token}`, primary: true }],
          }),
        )
      return
    }
    res
      .type('html')
      .send(
        page({
          title: 'Confirm unsubscribe',
          heading: 'Unsubscribe from these emails?',
          body: `<p>We will remove <strong>${escapeHtml(contact.email)}</strong>${contact.name ? ` (${escapeHtml(contact.name)})` : ''} from ${escapeHtml(contact.lists[0]?.name ?? 'this sender')}. You will stop receiving every campaign sent to this address.</p>`,
          actions: [
            { label: 'Unsubscribe', href: `/t/u/${token}`, method: 'post', primary: true },
            { label: 'Manage preferences', href: `/t/p/${token}` },
          ],
        }),
      )
  })

  router.post('/u/:token', (req, res) => {
    const result = doUnsubscribe(String(req.params.token ?? ''), req)
    if (!result) {
      res
        .status(404)
        .type('html')
        .send(page({ title: 'Unsubscribe', heading: 'This link has expired', tone: 'warn', body: '<p>The link is not valid for this workspace.</p>' }))
      return
    }
    res
      .type('html')
      .send(
        page({
          title: 'Unsubscribed',
          heading: result.already ? 'You were already unsubscribed' : 'You have been unsubscribed',
          tone: 'ok',
          body: `<p><strong>${escapeHtml(result.contact.email)}</strong> no longer receives ${escapeHtml(result.campaignName ?? 'these campaigns')}.</p>`,
          actions: [{ label: 'Update preferences', href: `/t/p/${String(req.params.token ?? '')}` }],
        }),
      )
  })

  router.get('/p/:token', (req, res) => {
    const token = String(req.params.token ?? '')
    const payload = readToken(token)
    const contact = payload && (payload.k === 'u' || payload.k === 'p') ? contactOrNull(payload.i) : null
    if (!contact) {
      res
        .status(404)
        .type('html')
        .send(page({ title: 'Preferences', heading: 'This link has expired', tone: 'warn', body: '<p>Open the link from a recent email.</p>' }))
      return
    }
    const rows = contact.lists
      .map((list) => `<tr><td>${escapeHtml(list.name)}</td><td>${contact.status === 'subscribed' ? 'Subscribed' : 'Paused'}</td></tr>`)
      .join('')
    res.type('html').send(
      page({
        title: 'Email preferences',
        heading: 'Your preferences',
        body: `<p>Email address <strong>${escapeHtml(contact.email)}</strong>.</p>
               <table>${rows || '<tr><td>No lists</td><td>—</td></tr>'}</table>`,
        actions:
          contact.status === 'subscribed'
            ? [{ label: 'Unsubscribe from everything', href: `/t/u/${token}`, method: 'post', primary: true }]
            : [{ label: 'Resubscribe', href: `/t/p/${token}`, method: 'post', primary: true }],
      }),
    )
  })

  router.post('/p/:token', (req, res) => {
    const payload = readToken(String(req.params.token ?? ''))
    const contact = payload ? contactOrNull(payload.i) : null
    if (!contact) {
      res
        .status(404)
        .type('html')
        .send(page({ title: 'Preferences', heading: 'Unknown subscriber', tone: 'warn', body: '<p>This link is not valid for this workspace.</p>' }))
      return
    }
    subscribe({ email: contact.email, name: contact.name, fields: contact.fields, listIds: contact.lists.map((list) => list.id), source: 'preference centre' })
    recordEvent({ kind: 'contact.subscribed', contactId: contact.id, message: `Resubscribed from preference centre: ${contact.email}`, meta: { email: contact.email, ...deviceOf(req) } })
    res
      .type('html')
      .send(
        page({
          title: 'Preferences saved',
          heading: 'You are subscribed again',
          tone: 'ok',
          body: `<p>Welcome back, ${escapeHtml(contact.name || contact.email)}.</p>`,
        }),
      )
  })

  return router
}

function recordOpen(sendId: number, campaignId: number | null, req: Request): void {
  const db = getDb()
  const send = db.get<SendRow>('SELECT id, campaign_id, contact_id, opened_at, to_email FROM sends WHERE id = ?', sendId)
  if (!send) return
  const now = nowIso()
  db.run('UPDATE sends SET open_count = open_count + 1, opened_at = COALESCE(opened_at, ?), updated_at = ? WHERE id = ?', now, now, send.id)
  if (send.opened_at) return // one activity entry per send keeps the feed readable
  recordEvent({
    kind: 'contact.opened',
    campaignId: send.campaign_id ?? campaignId,
    contactId: send.contact_id,
    sendId: send.id,
    message: `Opened: ${send.to_email}`,
    meta: { email: send.to_email, ...deviceOf(req) },
  })
  bus.publish('tracking', { type: 'open', sendId: send.id, at: now })
}

function recordClick(sendId: number, campaignId: number | null, url: string, req: Request): void {
  const db = getDb()
  const send = db.get<SendRow & { click_count: number }>('SELECT id, campaign_id, contact_id, clicked_at, click_count, to_email FROM sends WHERE id = ?', sendId)
  if (!send) return
  const now = nowIso()
  // a click implies the message was read, so backfill the open the client may have blocked
  db.run('UPDATE sends SET click_count = click_count + 1, clicked_at = ?, open_count = MAX(open_count, 1), opened_at = COALESCE(opened_at, ?), updated_at = ? WHERE id = ?', now, now, now, send.id)
  recordEvent({
    kind: 'contact.clicked',
    campaignId: send.campaign_id ?? campaignId,
    contactId: send.contact_id,
    sendId: send.id,
    message: `Clicked ${url.slice(0, 120)}`,
    meta: { email: send.to_email, url, first: !send.clicked_at, ...deviceOf(req) },
  })
  bus.publish('tracking', { type: 'click', sendId: send.id, url, at: now })
}

/* ── public subscribe endpoints ────────────────────────────────────────────── */

export function publicRouter(): Router {
  const router = Router()

  router.get('/lists/:token', (req, res) => {
    const list = getListByToken(String(req.params.token ?? ''))
    if (!list) {
      res
        .status(404)
        .type('html')
        .send(page({ title: 'List not found', heading: 'This signup link is not valid', tone: 'warn', body: '<p>Ask the sender for a fresh link.</p>' }))
      return
    }
    res.type('html').send(
      page({
        title: `Join ${list.name}`,
        heading: `Join ${list.name}`,
        body: `<p>${escapeHtml(list.description || 'Get the latest updates in your inbox.')}</p>
               <form method="post" action="/public/lists/${encodeURIComponent(list.subscribeToken)}">
                 <input name="email" type="email" placeholder="you@example.com" required autocomplete="email" />
                 <input name="name" type="text" placeholder="Your name" autocomplete="name" />
                 <div class="row"><button class="primary" type="submit">Subscribe</button></div>
               </form>`,
      }),
    )
  })

  router.post('/lists/:token', (req, res) => {
    const list = getListByToken(String(req.params.token ?? ''))
    if (!list) throw badRequest('This signup link is not valid')
    const body = (req.body ?? {}) as Record<string, unknown>
    const input = parseOr(publicSubscribeSchema, { email: body.email, name: body.name ?? '', fields: body.fields ?? {} })
    const result = subscribe({ email: input.email, name: input.name, fields: input.fields, listIds: [list.id], source: `public:${list.name}` })
    recordEvent({
      kind: 'contact.subscribed',
      contactId: result.contact.id,
      message: `${result.created ? 'Subscribed' : 'Updated'} ${result.contact.email} via ${list.name}`,
      meta: { email: result.contact.email, list: list.name, ...deviceOf(req) },
    })
    bus.publish('contact', { id: result.contact.id, email: result.contact.email, status: result.contact.status })

    const wantsJson = String(req.get('accept') ?? '').includes('json') || String(req.get('content-type') ?? '').includes('json')
    if (wantsJson) {
      res.status(result.created ? 201 : 200).json({ ok: true, created: result.created, email: result.contact.email, list: list.name })
      return
    }
    res
      .status(result.created ? 201 : 200)
      .type('html')
      .send(
        page({
          title: 'You are subscribed',
          heading: result.created ? 'Thanks — you are on the list' : 'Your details were updated',
          tone: 'ok',
          body: `<p>We will email <strong>${escapeHtml(result.contact.email)}</strong> when ${escapeHtml(list.name)} sends something new.</p>`,
        }),
      )
  })

  return router
}
