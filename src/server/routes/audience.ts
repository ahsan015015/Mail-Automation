import { Router } from 'express'
import { wrap } from '../middleware.js'
import {
  contactQuerySchema,
  contactSchema,
  contactUpdateSchema,
  importSchema,
  listSchema,
  listUpdateSchema,
  parseOr,
  tagSchema,
} from '../lib/validation.js'
import { badRequest, notFound } from '../lib/util.js'
import { recordEvent } from '../services/events.js'
import {
  audienceTotals,
  deleteContact,
  deleteContacts,
  exportCsv,
  fieldKeys,
  findContactByEmail,
  getContact,
  importCsv,
  listContacts,
  subscribe,
  unsubscribe,
  updateContact,
  createContact,
} from '../services/contacts.js'
import { contactEvents } from '../services/events.js'
import { createList, deleteList, getList, listLists, regenerateSubscribeToken, updateList } from '../services/lists.js'
import { createTag, deleteTag, listTags } from '../services/lists.js'
import { addToLists, setLists } from '../services/contacts.js'
import { getDb } from '../db/sqlite.js'
import { nowIso } from '../lib/util.js'

export function audienceRouter(): Router {
  const router = Router()

  /* ── lists ───────────────────────────────────────────────────────────────── */

  router.get(
    '/lists',
    wrap((req, res) => {
      const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true'
      res.json({
        items: listLists({ includeArchived, search: String(req.query.q ?? '') }),
        totals: audienceTotals(),
      })
    }),
  )

  router.post(
    '/lists',
    wrap((req, res) => {
      const input = parseOr(listSchema, req.body)
      res.status(201).json(createList(input))
    }),
  )

  router.get(
    '/lists/:id',
    wrap((req, res) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid list id')
      res.json(getList(id))
    }),
  )

  router.patch(
    '/lists/:id',
    wrap((req, res) => {
      const input = parseOr(listUpdateSchema, req.body)
      res.json(updateList(Number(req.params.id), input))
    }),
  )

  router.delete(
    '/lists/:id',
    wrap((req, res) => {
      deleteList(Number(req.params.id))
      res.json({ ok: true })
    }),
  )

  router.post(
    '/lists/:id/regenerate-token',
    wrap((req, res) => {
      res.json(regenerateSubscribeToken(Number(req.params.id)))
    }),
  )

  router.get(
    '/lists/:id/contacts',
    wrap((req, res) => {
      const id = Number(req.params.id)
      getList(id)
      const query = parseOr(contactQuerySchema, { ...req.query, listId: id })
      res.json(listContacts(query))
    }),
  )

  router.post(
    '/lists/:id/members',
    wrap((req, res) => {
      const id = Number(req.params.id)
      getList(id)
      const ids = Array.isArray(req.body?.contactIds) ? (req.body.contactIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
      if (!ids.length) throw badRequest('contactIds is required')
      for (const contactId of ids) {
        if (!getDb().get('SELECT id FROM contacts WHERE id = ?', contactId)) throw notFound(`Contact ${contactId} not found`)
        addToLists(contactId, [id])
      }
      res.json({ ok: true, added: ids.length })
    }),
  )

  router.delete(
    '/lists/:id/members/:contactId',
    wrap((req, res) => {
      const listId = Number(req.params.id)
      const contactId = Number(req.params.contactId)
      const current = getDb().all<{ list_id: number }>('SELECT list_id FROM contact_lists WHERE contact_id = ?', contactId).map((row) => row.list_id)
      setLists(
        contactId,
        current.filter((id) => id !== listId),
      )
      res.json({ ok: true })
    }),
  )

  /* ── tags ────────────────────────────────────────────────────────────────── */

  router.get('/tags', wrap((_req, res) => res.json({ items: listTags() })))

  router.post(
    '/tags',
    wrap((req, res) => {
      const input = parseOr(tagSchema, req.body)
      res.status(201).json(createTag(input.name, input.color))
    }),
  )

  router.delete(
    '/tags/:id',
    wrap((req, res) => {
      deleteTag(Number(req.params.id))
      res.json({ ok: true })
    }),
  )

  /* ── contacts ────────────────────────────────────────────────────────────── */

  router.get('/contacts/fields', wrap((_req, res) => res.json({ items: fieldKeys() })))

  router.get(
    '/contacts/export',
    wrap((req, res) => {
      const query = parseOr(contactQuerySchema, req.query)
      const csv = exportCsv(query)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="contacts-${nowIso().slice(0, 10)}.csv"`)
      res.send(csv)
    }),
  )

  router.get(
    '/contacts',
    wrap((req, res) => {
      const query = parseOr(contactQuerySchema, req.query)
      res.json(listContacts(query))
    }),
  )

  router.post(
    '/contacts',
    wrap((req, res) => {
      const input = parseOr(contactSchema, req.body)
      const contact = createContact(input)
      recordEvent({ kind: 'contact.subscribed', contactId: contact.id, message: `Added ${contact.email}`, meta: { email: contact.email } })
      res.status(201).json(contact)
    }),
  )

  router.post(
    '/contacts/import',
    wrap((req, res) => {
      const input = parseOr(importSchema, req.body)
      if (input.listId) getList(input.listId)
      const result = importCsv(input)
      recordEvent({
        kind: 'contact.imported',
        message: `Imported ${result.created} new / ${result.updated} updated contact(s)`,
        meta: { created: result.created, updated: result.updated, skipped: result.skipped.length },
      })
      res.json(result)
    }),
  )

  router.post(
    '/contacts/bulk-delete',
    wrap((req, res) => {
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
      if (!ids.length) throw badRequest('ids is required')
      res.json({ ok: true, deleted: deleteContacts(ids) })
    }),
  )

  router.get(
    '/contacts/by-email',
    wrap((req, res) => {
      const email = String(req.query.email ?? '')
      const contact = findContactByEmail(email)
      if (!contact) throw notFound('No contact with that email')
      res.json(contact)
    }),
  )

  router.get(
    '/contacts/:id',
    wrap((req, res) => {
      res.json(getContact(Number(req.params.id)))
    }),
  )

  router.patch(
    '/contacts/:id',
    wrap((req, res) => {
      const input = parseOr(contactUpdateSchema, req.body)
      res.json(updateContact(Number(req.params.id), input))
    }),
  )

  router.delete(
    '/contacts/:id',
    wrap((req, res) => {
      deleteContact(Number(req.params.id))
      res.json({ ok: true })
    }),
  )

  router.get(
    '/contacts/:id/events',
    wrap((req, res) => {
      res.json({ items: contactEvents(Number(req.params.id), 100) })
    }),
  )

  router.post(
    '/contacts/:id/unsubscribe',
    wrap((req, res) => {
      const contact = getContact(Number(req.params.id))
      const updated = unsubscribe(contact.id, 'marked from dashboard')
      recordEvent({ kind: 'contact.unsubscribed', contactId: contact.id, message: `Unsubscribed ${contact.email}`, meta: { email: contact.email } })
      res.json(updated)
    }),
  )

  router.post(
    '/contacts/:id/resubscribe',
    wrap((req, res) => {
      const contact = getContact(Number(req.params.id))
      const result = subscribe({ email: contact.email, name: contact.name, fields: contact.fields, listIds: contact.lists.map((list) => list.id), source: 'manual-resubscribe' })
      recordEvent({ kind: 'contact.subscribed', contactId: contact.id, message: `Resubscribed ${contact.email}`, meta: { email: contact.email } })
      res.json(result.contact)
    }),
  )

  return router
}
