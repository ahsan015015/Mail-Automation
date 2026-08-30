import { Router } from 'express'
import { wrap } from '../middleware.js'
import { campaignSchema, campaignUpdateSchema, parseOr, segmentSchema, startCampaignSchema, stepSchema, testSendSchema } from '../lib/validation.js'
import { badRequest, notFound } from '../lib/util.js'
import {
  addStep,
  cancelCampaign,
  campaignStats,
  createCampaign,
  deleteCampaign,
  deleteStep,
  duplicateCampaign,
  estimateAudience,
  getCampaign,
  listCampaigns,
  listSends,
  moveStep,
  pauseCampaign,
  reopenCampaign,
  resumeCampaign,
  retryFailed,
  startCampaign,
  updateCampaign,
  updateStep,
  validateReady,
} from '../services/campaigns.js'
import { campaignSeries, funnelFor } from '../services/stats.js'
import { listEvents } from '../services/events.js'
import { sendTest } from '../services/test-send.js'
import { engine } from '../services/engine.js'

export function campaignRouter(): Router {
  const router = Router()

  router.get(
    '/campaigns',
    wrap((req, res) => {
      res.json(
        listCampaigns({
          status: (req.query.status as string) ? (String(req.query.status) as never) : 'all',
          q: String(req.query.q ?? ''),
          page: Number(req.query.page ?? 1),
          perPage: Number(req.query.perPage ?? 25),
        }),
      )
    }),
  )

  router.post(
    '/campaigns',
    wrap((req, res) => {
      const input = parseOr(campaignSchema, req.body)
      res.status(201).json(createCampaign(input))
    }),
  )

  router.post(
    '/campaigns/estimate',
    wrap((req, res) => {
      const segment = parseOr(segmentSchema, req.body?.segment ?? req.body)
      res.json(estimateAudience(segment))
    }),
  )

  router.get(
    '/campaigns/:id',
    wrap((req, res) => {
      res.json(getCampaign(Number(req.params.id)))
    }),
  )

  router.patch(
    '/campaigns/:id',
    wrap((req, res) => {
      const input = parseOr(campaignUpdateSchema, req.body)
      res.json(updateCampaign(Number(req.params.id), input))
    }),
  )

  router.delete(
    '/campaigns/:id',
    wrap((req, res) => {
      deleteCampaign(Number(req.params.id))
      res.json({ ok: true })
    }),
  )

  router.post(
    '/campaigns/:id/duplicate',
    wrap((req, res) => {
      res.status(201).json(duplicateCampaign(Number(req.params.id)))
    }),
  )

  router.post(
    '/campaigns/:id/validate',
    wrap((req, res) => {
      const campaign = getCampaign(Number(req.params.id))
      res.json({ ready: validateReady(campaign).length === 0, problems: validateReady(campaign) })
    }),
  )

  router.post(
    '/campaigns/:id/start',
    wrap((req, res) => {
      const id = Number(req.params.id)
      const { at } = parseOr(startCampaignSchema, req.body ?? {})
      const campaign = startCampaign(id, at)
      // nudge the worker so a "start now" click feels instant
      if (campaign.status === 'running') void engine.tick().catch(() => undefined)
      res.json(campaign)
    }),
  )

  router.post(
    '/campaigns/:id/pause',
    wrap((req, res) => {
      res.json(pauseCampaign(Number(req.params.id)))
    }),
  )

  router.post(
    '/campaigns/:id/resume',
    wrap((req, res) => {
      const campaign = resumeCampaign(Number(req.params.id))
      if (campaign.status === 'running') void engine.tick().catch(() => undefined)
      res.json(campaign)
    }),
  )

  router.post(
    '/campaigns/:id/cancel',
    wrap((req, res) => {
      res.json(cancelCampaign(Number(req.params.id)))
    }),
  )

  router.post(
    '/campaigns/:id/retry-failed',
    wrap((req, res) => {
      const id = Number(req.params.id)
      const retried = retryFailed(id)
      if (retried) reopenCampaign(id)
      void engine.tick().catch(() => undefined)
      res.json({ ok: true, retried, campaign: getCampaign(id) })
    }),
  )

  router.post(
    '/campaigns/:id/send-test',
    wrap(async (req, res) => {
      const id = Number(req.params.id)
      const input = parseOr(testSendSchema, req.body)
      const campaign = getCampaign(id)
      const step = input.stepId ? campaign.steps.find((candidate) => candidate.id === Number(input.stepId)) : campaign.steps[0]
      if (!step) throw notFound('This campaign has no email steps yet')
      const result = await sendTest(
        {
          to: input.email,
          subject: step.subject || campaign.name,
          preheader: step.preheader,
          html: step.html,
          text: step.text,
          campaignName: campaign.name,
          campaignId: campaign.id,
          fromName: campaign.fromName,
          fromEmail: campaign.fromEmail,
          replyTo: campaign.replyTo,
        },
        req,
      )
      res.json(result)
    }),
  )

  router.get(
    '/campaigns/:id/stats',
    wrap((req, res) => {
      const id = Number(req.params.id)
      res.json({ stats: campaignStats(id), funnel: funnelFor(id) })
    }),
  )

  router.get(
    '/campaigns/:id/series',
    wrap((req, res) => {
      const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)))
      res.json({ points: campaignSeries(Number(req.params.id), hours) })
    }),
  )

  router.get(
    '/campaigns/:id/funnel',
    wrap((req, res) => {
      res.json({ points: funnelFor(Number(req.params.id)) })
    }),
  )

  router.get(
    '/campaigns/:id/sends',
    wrap((req, res) => {
      res.json(
        listSends({
          campaignId: Number(req.params.id),
          status: (req.query.status as string) ? (String(req.query.status) as never) : 'all',
          stepId: req.query.stepId ? Number(req.query.stepId) : undefined,
          q: String(req.query.q ?? ''),
          page: Number(req.query.page ?? 1),
          perPage: Number(req.query.perPage ?? 25),
        }),
      )
    }),
  )

  router.get(
    '/campaigns/:id/events',
    wrap((req, res) => {
      res.json({ items: listEvents(100, Number(req.params.id)) })
    }),
  )

  router.post(
    '/campaigns/:id/steps',
    wrap((req, res) => {
      const input = parseOr(stepSchema, { ...req.body, position: undefined })
      res.status(201).json(addStep(Number(req.params.id), input))
    }),
  )

  router.patch(
    '/campaigns/:id/steps/:stepId',
    wrap((req, res) => {
      const input = parseOr(stepSchema.partial(), req.body)
      res.json(updateStep(Number(req.params.id), Number(req.params.stepId), input))
    }),
  )

  router.delete(
    '/campaigns/:id/steps/:stepId',
    wrap((req, res) => {
      deleteStep(Number(req.params.id), Number(req.params.stepId))
      res.json({ ok: true })
    }),
  )

  router.post(
    '/campaigns/:id/steps/:stepId/move',
    wrap((req, res) => {
      const direction = String(req.body?.direction ?? '') === 'up' ? 'up' : 'down'
      moveStep(Number(req.params.id), Number(req.params.stepId), direction)
      res.json(getCampaign(Number(req.params.id)))
    }),
  )

  return router
}
