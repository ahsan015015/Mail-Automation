import { Router } from 'express'
import { wrap } from '../middleware.js'
import { parseOr, previewSchema, templateSchema, templateUpdateSchema, testSendSchema } from '../lib/validation.js'
import { analyze, render, sampleContact } from '../lib/merge.js'
import { sanitizeEmailHtml, htmlToText } from '../lib/html.js'
import { createTemplate, deleteTemplate, duplicateTemplate, getTemplate, listTemplates, updateTemplate } from '../services/templates.js'
import { sendTest } from '../services/test-send.js'

export function templateRouter(): Router {
  const router = Router()

  router.get(
    '/templates',
    wrap((req, res) => {
      res.json(listTemplates({ q: String(req.query.q ?? ''), page: Number(req.query.page ?? 1), perPage: Number(req.query.perPage ?? 50) }))
    }),
  )

  router.post(
    '/templates',
    wrap((req, res) => {
      const input = parseOr(templateSchema, req.body)
      res.status(201).json(createTemplate(input))
    }),
  )

  /** Render + variable audit against a sample (or a real contact) — no DB writes. */
  router.post(
    '/templates/preview',
    wrap((req, res) => {
      const input = parseOr(previewSchema, req.body)
      const contact = sampleContact(input.sample)
      const ctx = { contact, campaign: { name: String(input.sample.campaign ?? 'Preview') }, unsubscribeUrl: 'https://example.com/t/u/preview' }
      const html = render(input.html, ctx)
      const text = render(input.text || htmlToText(html), ctx)
      res.json({
        subject: render(input.subject, ctx),
        preheader: render(input.preheader, ctx),
        html: sanitizeEmailHtml(html),
        text,
        issues: [...analyze(input.subject, ctx).unknown, ...analyze(input.html, ctx).unknown, ...analyze(input.text, ctx).unknown].filter(
          (value, index, all) => all.indexOf(value) === index,
        ),
      })
    }),
  )

  router.get(
    '/templates/:id',
    wrap((req, res) => {
      res.json(getTemplate(Number(req.params.id)))
    }),
  )

  router.patch(
    '/templates/:id',
    wrap((req, res) => {
      res.json(updateTemplate(Number(req.params.id), parseOr(templateUpdateSchema, req.body)))
    }),
  )

  router.delete(
    '/templates/:id',
    wrap((req, res) => {
      deleteTemplate(Number(req.params.id))
      res.json({ ok: true })
    }),
  )

  router.post(
    '/templates/:id/duplicate',
    wrap((req, res) => {
      res.status(201).json(duplicateTemplate(Number(req.params.id)))
    }),
  )

  router.post(
    '/templates/:id/test',
    wrap(async (req, res) => {
      const input = parseOr(testSendSchema, req.body)
      const template = getTemplate(Number(req.params.id))
      const result = await sendTest({
        to: input.email,
        subject: template.subject || 'Template preview',
        preheader: template.preheader,
        html: template.html,
        text: template.text,
        campaignName: template.name,
      })
      res.json(result)
    }),
  )

  return router
}
