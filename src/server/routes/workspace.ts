import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { config } from '../lib/config.js'
import { wrap } from '../middleware.js'
import { parseOr, settingsSchema } from '../lib/validation.js'
import { badRequest, notFound } from '../lib/util.js'
import { getDb } from '../db/sqlite.js'
import { publicSettings, updateSettings } from '../services/settings.js'
import { resetTransporter, verifyTransport } from '../services/mailer.js'
import { clearMailbox, getMessage, listMessages, simulateOpen } from '../services/mailbox.js'
import { bus, listEvents, recordEvent } from '../services/events.js'
import { dashboard, growthSeries } from '../services/stats.js'
import { campaignStats } from '../services/campaigns.js'
import { engine } from '../services/engine.js'
import { audienceTotals } from '../services/contacts.js'

export function workspaceRouter(): Router {
  const router = Router()

  /* ── settings ────────────────────────────────────────────────────────────── */

  router.get(
    '/settings',
    wrap((_req, res) => {
      res.json(publicSettings())
    }),
  )

  router.put(
    '/settings',
    wrap((req, res) => {
      const patch = parseOr(settingsSchema, req.body)
      const next = updateSettings(patch)
      resetTransporter()
      recordEvent({ kind: 'contact.subscribed', message: 'Workspace settings updated' })
      res.json(next)
    }),
  )

  router.post(
    '/settings/smtp/test',
    wrap(async (_req, res) => {
      const result = await verifyTransport()
      res.status(result.ok ? 200 : 502).json(result)
    }),
  )

  /* ── stats ───────────────────────────────────────────────────────────────── */

  router.get('/stats/dashboard', wrap((_req, res) => res.json(dashboard())))
  router.get('/stats/growth', wrap((req, res) => res.json({ points: growthSeries(Math.min(90, Math.max(7, Number(req.query.days ?? 14)))) })))
  router.get('/stats/campaigns/:id', wrap((req, res) => res.json(campaignStats(Number(req.params.id)))))
  router.get('/stats/contacts', wrap((_req, res) => res.json(audienceTotals())))
  router.get('/activity', wrap((req, res) => res.json({ items: listEvents(Math.min(200, Math.max(5, Number(req.query.limit ?? 40)))) })))

  /* ── local mailbox (mail catcher) ────────────────────────────────────────── */

  router.get(
    '/mailbox',
    wrap((req, res) => {
      res.json(
        listMessages({
          q: String(req.query.q ?? ''),
          campaignId: req.query.campaignId ? Number(req.query.campaignId) : undefined,
          page: Number(req.query.page ?? 1),
          perPage: Number(req.query.perPage ?? 20),
        }),
      )
    }),
  )

  router.get(
    '/mailbox/:id',
    wrap((req, res) => {
      const message = getMessage(Number(req.params.id))
      if (!message) throw notFound('Message not found')
      res.json(message)
    }),
  )

  router.get(
    '/mailbox/:id/raw',
    wrap((req, res) => {
      const message = getMessage(Number(req.params.id))
      if (!message) throw notFound('Message not found')
      const file = message.emlPath ? path.resolve(message.emlPath) : ''
      if (file && fs.existsSync(file)) {
        res.setHeader('Content-Type', 'message/rfc822')
        res.setHeader('Content-Disposition', `attachment; filename="message-${message.id}.eml"`)
        res.send(fs.readFileSync(file))
        return
      }
      const headers = Object.entries(message.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.send(
        `From: ${message.fromName ? `"${message.fromName}" ` : ''}<${message.fromEmail}>\r\nTo: <${message.toEmail}>\r\nSubject: ${message.subject}\r\nMessage-ID: <${message.messageId ?? ''}>\r\n${headers}\r\n\r\n${message.text || message.html}`,
      )
    }),
  )

  /** Demo aid: pretend the recipient opened the message, so tracking lights up. */
  router.post(
    '/mailbox/:id/simulate-open',
    wrap((req, res) => {
      const before = getMessage(Number(req.params.id))
      if (!before) throw notFound('Message not found')
      const message = simulateOpen(before.id)
      if (!message) throw notFound('Message not found')
      if (message.sendId) {
        const send = getDb().get<{ id: number; campaign_id: number | null; contact_id: number | null; to_email: string }>(
          'SELECT id, campaign_id, contact_id, to_email FROM sends WHERE id = ?',
          message.sendId,
        )
        recordEvent({
          kind: 'contact.opened',
          campaignId: send?.campaign_id ?? message.campaignId,
          contactId: send?.contact_id,
          sendId: message.sendId,
          message: `Opened (simulated): ${message.toEmail}`,
          meta: { email: message.toEmail, simulated: true },
        })
        bus.publish('tracking', { type: 'open', sendId: message.sendId, simulated: true })
      }
      res.json({ ok: true, message, stats: message.campaignId ? campaignStats(message.campaignId) : null })
    }),
  )

  router.delete(
    '/mailbox',
    wrap((_req, res) => {
      res.json({ ok: true, removed: clearMailbox() })
    }),
  )

  /* ── engine controls ─────────────────────────────────────────────────────── */

  router.get(
    '/engine',
    wrap((_req, res) => {
      res.json({ ...engine.status(), limits: { dailyCap: publicSettings().sending.dailyCap, ratePerMinute: publicSettings().sending.ratePerMinute, maxAttempts: publicSettings().sending.maxAttempts } })
    }),
  )

  router.post(
    '/engine/tick',
    wrap(async (_req, res) => {
      res.json(await engine.tick())
    }),
  )

  router.post(
    '/engine/drain',
    wrap(async (req, res) => {
      const maxRounds = Math.min(400, Math.max(1, Number(req.body?.maxRounds ?? 60)))
      res.json(await engine.drain({ maxRounds }))
    }),
  )

  /* ── live stream ─────────────────────────────────────────────────────────── */

  // EventSource sends same-origin cookies automatically, so plain session auth applies.
  router.get('/stream', (req, res) => {
    const detach = bus.attach(res)
    res.on('close', detach)
  })

  return router
}
