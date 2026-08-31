import type {
  CampaignDto,
  CampaignSchedule,
  CampaignTracking,
  CampaignType,
  ContactDto,
  ContactStatus,
  ImportResult,
  ListDto,
  Paged,
  Segment,
  StepDto,
  TagDto,
  TemplateDto,
  WorkspaceSettings,
} from '@shared/types'
import { render, analyze, sampleContact } from '../../../server/lib/merge'
import { sanitizeEmailHtml, htmlToText } from '../../../server/lib/html'
import { csvToContacts } from '../../../server/lib/csv'
import { apiError } from '../api'
import { getStore, saveStore, clone, type DemoStore } from './store'
import { simulateTick, simulateDrain } from './engine'
import {
  audienceTotals,
  dashboardSeries,
  funnelFor,
  growthSeries,
  matchesSegment,
  nowIso,
  paginate,
  randomToken,
  recomputeCampaignStats,
  recomputeListCounts,
  recomputeTagCounts,
  recordEvent,
  seriesFor,
} from './helpers'

function validateCampaign(campaign: CampaignDto): string[] {
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

export async function handleDemoRequest<T>(route: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const rawUrl = route.startsWith('/') ? route : `/${route}`
  const url = new URL(rawUrl, 'http://localhost')
  const pathname = url.pathname.replace(/^\/api/, '')
  const params = url.searchParams
  const body = init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {}

  const store = getStore()

  // Helper to persist changes and return a clone
  const respond = <R>(data: R): R => {
    saveStore(store)
    return clone(data)
  }

  /* ── Bootstrap & Auth ─────────────────────────────────────────────────── */

  if (pathname === '/bootstrap' && method === 'GET') {
    return respond<T>({
      user: store.user,
      needsSetup: !store.user,
      settings: store.user ? store.settings : undefined,
      app: { name: 'Mail Automation', version: '1.0.0', env: 'demo' },
    } as T)
  }

  if (pathname === '/auth/login' && method === 'POST') {
    if (!store.user) {
      store.user = {
        id: 1,
        email: body.email || 'admin@maillocal.dev',
        name: 'Demo Admin',
        role: 'owner',
        createdAt: nowIso(),
      }
    }
    return respond<T>({ user: store.user, csrfOk: true } as T)
  }

  if (pathname === '/auth/setup' && method === 'POST') {
    store.user = {
      id: 1,
      email: body.email || 'admin@maillocal.dev',
      name: body.name || 'Workspace owner',
      role: 'owner',
      createdAt: nowIso(),
    }
    return respond<T>({ user: store.user, at: nowIso() } as T)
  }

  if (pathname === '/auth/logout' && method === 'POST') {
    store.user = null
    return respond<T>({ ok: true } as T)
  }

  if (pathname === '/auth/me' && method === 'GET') {
    return respond<T>({
      user: store.user,
      needsSetup: !store.user,
      workspaceName: store.settings.workspaceName,
      demoMode: true,
    } as T)
  }

  if (pathname === '/health' && method === 'GET') {
    return respond<T>({
      ok: true,
      service: 'mail-automation',
      version: '1.0.0',
      env: 'demo',
      transport: 'memory',
      database: { file: 'localStorage' },
      at: nowIso(),
    } as T)
  }

  /* ── Lists ────────────────────────────────────────────────────────────── */

  if (pathname === '/lists' && method === 'GET') {
    recomputeListCounts(store)
    const includeArchived = params.get('includeArchived') === '1' || params.get('includeArchived') === 'true'
    const q = (params.get('q') || '').toLowerCase().trim()
    let items = store.lists.filter((l) => (includeArchived ? true : !l.archived))
    if (q) items = items.filter((l) => l.name.toLowerCase().includes(q))
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return respond<T>({ items, totals: audienceTotals(store) } as T)
  }

  if (pathname === '/lists' && method === 'POST') {
    const name = (body.name || '').trim()
    if (!name) throw apiError('List name is required', 400)
    if (store.lists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      throw apiError(`A list called “${name}” already exists`, 409)
    }
    const nextId = Math.max(0, ...store.lists.map((l) => l.id)) + 1
    const newList: ListDto = {
      id: nextId,
      name,
      description: (body.description || '').trim(),
      archived: Boolean(body.archived),
      subscribeToken: randomToken(12),
      contactCount: 0,
      subscribedCount: 0,
      unsubscribeCount: 0,
      createdAt: nowIso(),
    }
    store.lists.push(newList)
    return respond<T>(newList as T)
  }

  const listMatch = pathname.match(/^\/lists\/(\d+)$/)
  if (listMatch && method === 'GET') {
    const id = Number(listMatch[1])
    recomputeListCounts(store)
    const list = store.lists.find((l) => l.id === id)
    if (!list) throw apiError('List not found', 404)
    return respond<T>(list as T)
  }

  if (listMatch && method === 'PATCH') {
    const id = Number(listMatch[1])
    const list = store.lists.find((l) => l.id === id)
    if (!list) throw apiError('List not found', 404)
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (name.toLowerCase() !== list.name.toLowerCase() && store.lists.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) {
        throw apiError(`A list called “${name}” already exists`, 409)
      }
      list.name = name
    }
    if (body.description !== undefined) list.description = body.description.trim()
    if (body.archived !== undefined) list.archived = Boolean(body.archived)
    recomputeListCounts(store)
    return respond<T>(list as T)
  }

  if (listMatch && method === 'DELETE') {
    const id = Number(listMatch[1])
    const index = store.lists.findIndex((l) => l.id === id)
    if (index === -1) throw apiError('List not found', 404)
    store.lists.splice(index, 1)
    for (const c of store.contacts) {
      c.lists = c.lists.filter((l) => l.id !== id)
    }
    return respond<T>({ ok: true } as T)
  }

  const listRegenMatch = pathname.match(/^\/lists\/(\d+)\/regenerate-token$/)
  if (listRegenMatch && method === 'POST') {
    const id = Number(listRegenMatch[1])
    const list = store.lists.find((l) => l.id === id)
    if (!list) throw apiError('List not found', 404)
    list.subscribeToken = randomToken(12)
    return respond<T>(list as T)
  }

  const listContactsMatch = pathname.match(/^\/lists\/(\d+)\/contacts$/)
  if (listContactsMatch && method === 'GET') {
    const listId = Number(listContactsMatch[1])
    const list = store.lists.find((l) => l.id === listId)
    if (!list) throw apiError('List not found', 404)
    const q = (params.get('q') || '').toLowerCase().trim()
    const status = params.get('status')
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 25)

    let items = store.contacts.filter((c) => c.lists.some((l) => l.id === listId))
    if (status && status !== 'all') {
      items = items.filter((c) => c.status === status)
    }
    if (q) {
      items = items.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          JSON.stringify(c.fields).toLowerCase().includes(q),
      )
    }
    return respond<T>(paginate(items, page, perPage) as T)
  }

  const listMembersMatch = pathname.match(/^\/lists\/(\d+)\/members$/)
  if (listMembersMatch && method === 'POST') {
    const listId = Number(listMembersMatch[1])
    const list = store.lists.find((l) => l.id === listId)
    if (!list) throw apiError('List not found', 404)
    const contactIds: number[] = Array.isArray(body.contactIds) ? body.contactIds.map(Number) : []
    let added = 0
    for (const cId of contactIds) {
      const contact = store.contacts.find((c) => c.id === cId)
      if (contact && !contact.lists.some((l) => l.id === listId)) {
        contact.lists.push({ id: list.id, name: list.name })
        added++
      }
    }
    recomputeListCounts(store)
    return respond<T>({ ok: true, added } as T)
  }

  const listRemoveMemberMatch = pathname.match(/^\/lists\/(\d+)\/members\/(\d+)$/)
  if (listRemoveMemberMatch && method === 'DELETE') {
    const listId = Number(listRemoveMemberMatch[1])
    const contactId = Number(listRemoveMemberMatch[2])
    const contact = store.contacts.find((c) => c.id === contactId)
    if (contact) {
      contact.lists = contact.lists.filter((l) => l.id !== listId)
      recomputeListCounts(store)
    }
    return respond<T>({ ok: true } as T)
  }

  /* ── Tags ─────────────────────────────────────────────────────────────── */

  if (pathname === '/tags' && method === 'GET') {
    recomputeTagCounts(store)
    const items = [...store.tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return respond<T>({ items } as T)
  }

  if (pathname === '/tags' && method === 'POST') {
    const clean = (body.name || '').trim().replace(/^#/, '')
    if (!clean) throw apiError('Tag name is required', 400)
    if (store.tags.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
      throw apiError(`Tag “${clean}” already exists`, 409)
    }
    const nextId = Math.max(0, ...store.tags.map((t) => t.id)) + 1
    const newTag: TagDto = {
      id: nextId,
      name: clean,
      color: body.color || '#6366f1',
      contactCount: 0,
    }
    store.tags.push(newTag)
    return respond<T>(newTag as T)
  }

  const tagMatch = pathname.match(/^\/tags\/(\d+)$/)
  if (tagMatch && method === 'DELETE') {
    const id = Number(tagMatch[1])
    const index = store.tags.findIndex((t) => t.id === id)
    if (index === -1) throw apiError('Tag not found', 404)
    store.tags.splice(index, 1)
    for (const c of store.contacts) {
      c.tags = c.tags.filter((t) => t.id !== id)
    }
    return respond<T>({ ok: true } as T)
  }

  /* ── Contacts ─────────────────────────────────────────────────────────── */

  if (pathname === '/contacts/fields' && method === 'GET') {
    const seen = new Set<string>()
    for (const c of store.contacts) {
      for (const k of Object.keys(c.fields || {})) {
        if (k !== 'tags') seen.add(k)
      }
    }
    return respond<T>({ items: Array.from(seen).slice(0, 40) } as T)
  }

  if (pathname === '/contacts/export' && method === 'GET') {
    const rows = store.contacts.map((c) => ({
      email: c.email,
      name: c.name,
      status: c.status,
      tags: c.tags.map((t) => t.name).join(','),
      lists: c.lists.map((l) => l.name).join(','),
      ...c.fields,
    }))
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
    const csvLines = [cols.join(',')]
    for (const r of rows) {
      csvLines.push(cols.map((col) => JSON.stringify(r[col as keyof typeof r] ?? '')).join(','))
    }
    return csvLines.join('\n') as unknown as T
  }

  if (pathname === '/contacts/bulk-delete' && method === 'POST') {
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number) : []
    const toDelete = new Set(ids)
    const initialLen = store.contacts.length
    store.contacts = store.contacts.filter((c) => !toDelete.has(c.id))
    recomputeListCounts(store)
    recomputeTagCounts(store)
    return respond<T>({ ok: true, deleted: initialLen - store.contacts.length } as T)
  }

  if (pathname === '/contacts/by-email' && method === 'GET') {
    const email = (params.get('email') || '').toLowerCase().trim()
    const contact = store.contacts.find((c) => c.email.toLowerCase() === email)
    if (!contact) throw apiError('No contact with that email', 404)
    return respond<T>(contact as T)
  }

  if (pathname === '/contacts' && method === 'GET') {
    const q = (params.get('q') || '').toLowerCase().trim()
    const listId = params.get('listId') ? Number(params.get('listId')) : undefined
    const tagId = params.get('tagId') ? Number(params.get('tagId')) : undefined
    const status = params.get('status')
    const sort = params.get('sort') || 'created_desc'
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 25)

    let items = [...store.contacts]
    if (status && status !== 'all') {
      items = items.filter((c) => c.status === status)
    }
    if (listId) {
      items = items.filter((c) => c.lists.some((l) => l.id === listId))
    }
    if (tagId) {
      items = items.filter((c) => c.tags.some((t) => t.id === tagId))
    }
    if (q) {
      items = items.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          JSON.stringify(c.fields).toLowerCase().includes(q),
      )
    }

    if (sort === 'created_asc') items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    else if (sort === 'email_asc') items.sort((a, b) => a.email.localeCompare(b.email, undefined, { sensitivity: 'base' }))
    else if (sort === 'email_desc') items.sort((a, b) => b.email.localeCompare(a.email, undefined, { sensitivity: 'base' }))
    else if (sort === 'opened_desc') items.sort((a, b) => (b.lastOpenAt || '').localeCompare(a.lastOpenAt || '') || b.id - a.id)
    else items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)

    return respond<T>(paginate(items, page, perPage) as T)
  }

  if (pathname === '/contacts' && method === 'POST') {
    const email = (body.email || '').toLowerCase().trim()
    if (!email) throw apiError('Email is required', 400)
    if (store.contacts.some((c) => c.email.toLowerCase() === email)) {
      throw apiError(`${email} is already in your audience`, 409)
    }

    const nextId = Math.max(0, ...store.contacts.map((c) => c.id)) + 1
    const listIds: number[] = Array.isArray(body.listIds) ? body.listIds.map(Number) : []
    const contactLists = store.lists.filter((l) => listIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name }))

    const tagNames: string[] = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : []
    const contactTags: TagDto[] = []
    for (const name of tagNames) {
      let tag = store.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (!tag) {
        tag = { id: Math.max(0, ...store.tags.map((t) => t.id)) + 1, name, color: '#6366f1', contactCount: 0 }
        store.tags.push(tag)
      }
      contactTags.push({ id: tag.id, name: tag.name, color: tag.color, contactCount: 0 })
    }

    const newContact: ContactDto = {
      id: nextId,
      email,
      name: (body.name || '').trim(),
      fields: typeof body.fields === 'object' && body.fields ? body.fields : {},
      status: (body.status as ContactStatus) || 'subscribed',
      tags: contactTags,
      lists: contactLists,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      lastOpenAt: null,
      lastClickAt: null,
      unsubscribedAt: body.status === 'unsubscribed' ? nowIso() : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }

    store.contacts.unshift(newContact)
    recordEvent(store, {
      kind: 'contact.subscribed',
      contactId: newContact.id,
      message: `Added ${newContact.email}`,
      meta: { email: newContact.email },
    })

    recomputeListCounts(store)
    recomputeTagCounts(store)
    return respond<T>(newContact as T)
  }

  if (pathname === '/contacts/import' && method === 'POST') {
    const parsed = csvToContacts(body.csv || '')
    const result: ImportResult = {
      created: 0,
      updated: 0,
      skipped: [...parsed.skipped],
      total: parsed.contacts.length,
      tagsCreated: 0,
      columns: parsed.columns,
    }

    const extraTags = (Array.isArray(body.tags) ? body.tags : []).map((t: string) => String(t).trim()).filter(Boolean)
    const listId = body.listId ? Number(body.listId) : undefined
    const list = listId ? store.lists.find((l) => l.id === listId) : null
    const tagsBefore = store.tags.length

    for (const [index, row] of parsed.contacts.entries()) {
      const email = row.email.toLowerCase().trim()
      if (!email.includes('@') || !email.includes('.')) {
        result.skipped.push({ line: index + 1, reason: `invalid email “${row.email}”` })
        continue
      }
      const rowTags = (row.fields?.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
      const allTags = [...rowTags, ...extraTags]
      const fields = { ...row.fields }
      delete fields.tags

      const existing = store.contacts.find((c) => c.email.toLowerCase() === email)
      if (existing) {
        if (body.duplicatePolicy === 'skip') {
          result.skipped.push({ line: index + 1, reason: 'duplicate kept as-is' })
          continue
        }
        existing.name = row.name || existing.name
        existing.fields = { ...existing.fields, ...fields }
        existing.status = (body.defaultStatus as ContactStatus) || existing.status || 'subscribed'
        existing.updatedAt = nowIso()
        if (list && !existing.lists.some((l) => l.id === list.id)) {
          existing.lists.push({ id: list.id, name: list.name })
        }
        for (const tName of allTags) {
          let tag = store.tags.find((t) => t.name.toLowerCase() === tName.toLowerCase())
          if (!tag) {
            tag = { id: Math.max(0, ...store.tags.map((t) => t.id)) + 1, name: tName, color: '#6366f1', contactCount: 0 }
            store.tags.push(tag)
          }
          if (!existing.tags.some((t) => t.id === tag!.id)) {
            existing.tags.push({ id: tag.id, name: tag.name, color: tag.color, contactCount: 0 })
          }
        }
        result.updated++
        continue
      }

      const contactTags: TagDto[] = []
      for (const tName of allTags) {
        let tag = store.tags.find((t) => t.name.toLowerCase() === tName.toLowerCase())
        if (!tag) {
          tag = { id: Math.max(0, ...store.tags.map((t) => t.id)) + 1, name: tName, color: '#6366f1', contactCount: 0 }
          store.tags.push(tag)
        }
        contactTags.push({ id: tag.id, name: tag.name, color: tag.color, contactCount: 0 })
      }

      const nextId = Math.max(0, ...store.contacts.map((c) => c.id)) + 1
      const createdContact: ContactDto = {
        id: nextId,
        email,
        name: row.name,
        fields,
        status: (body.defaultStatus as ContactStatus) || 'subscribed',
        tags: contactTags,
        lists: list ? [{ id: list.id, name: list.name }] : [],
        sentCount: 0,
        openCount: 0,
        clickCount: 0,
        lastOpenAt: null,
        lastClickAt: null,
        unsubscribedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }

      store.contacts.push(createdContact)
      result.created++
    }

    result.tagsCreated = store.tags.length - tagsBefore
    if (!result.total) result.skipped.push({ line: 0, reason: 'No rows found — the file needs an `email` column' })

    recordEvent(store, {
      kind: 'contact.imported',
      message: `Imported ${result.created} new / ${result.updated} updated contact(s)`,
      meta: { created: result.created, updated: result.updated, skipped: result.skipped.length },
    })

    recomputeListCounts(store)
    recomputeTagCounts(store)
    return respond<T>(result as T)
  }

  const contactMatch = pathname.match(/^\/contacts\/(\d+)$/)
  if (contactMatch && method === 'GET') {
    const id = Number(contactMatch[1])
    const contact = store.contacts.find((c) => c.id === id)
    if (!contact) throw apiError('Contact not found', 404)
    return respond<T>(contact as T)
  }

  if (contactMatch && method === 'PATCH') {
    const id = Number(contactMatch[1])
    const contact = store.contacts.find((c) => c.id === id)
    if (!contact) throw apiError('Contact not found', 404)

    if (body.email !== undefined) {
      const email = body.email.toLowerCase().trim()
      if (email !== contact.email.toLowerCase() && store.contacts.some((c) => c.id !== id && c.email.toLowerCase() === email)) {
        throw apiError('Another contact already uses that email', 409)
      }
      contact.email = email
    }
    if (body.name !== undefined) contact.name = body.name.trim()
    if (body.fields !== undefined) contact.fields = body.fields
    if (body.status !== undefined) {
      contact.status = body.status
      if (body.status === 'unsubscribed') contact.unsubscribedAt = contact.unsubscribedAt || nowIso()
      else if (body.status === 'subscribed') contact.unsubscribedAt = null
    }
    if (body.listIds !== undefined) {
      const listIds: number[] = Array.isArray(body.listIds) ? body.listIds.map(Number) : []
      contact.lists = store.lists.filter((l) => listIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name }))
    }
    if (body.tags !== undefined) {
      const tagNames: string[] = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : []
      const contactTags: TagDto[] = []
      for (const name of tagNames) {
        let tag = store.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
        if (!tag) {
          tag = { id: Math.max(0, ...store.tags.map((t) => t.id)) + 1, name, color: '#6366f1', contactCount: 0 }
          store.tags.push(tag)
        }
        contactTags.push({ id: tag.id, name: tag.name, color: tag.color, contactCount: 0 })
      }
      contact.tags = contactTags
    }
    contact.updatedAt = nowIso()
    recomputeListCounts(store)
    recomputeTagCounts(store)
    return respond<T>(contact as T)
  }

  if (contactMatch && method === 'DELETE') {
    const id = Number(contactMatch[1])
    const index = store.contacts.findIndex((c) => c.id === id)
    if (index === -1) throw apiError('Contact not found', 404)
    store.contacts.splice(index, 1)
    recomputeListCounts(store)
    recomputeTagCounts(store)
    return respond<T>({ ok: true } as T)
  }

  const contactEventsMatch = pathname.match(/^\/contacts\/(\d+)\/events$/)
  if (contactEventsMatch && method === 'GET') {
    const id = Number(contactEventsMatch[1])
    const items = store.events.filter((e) => e.contactId === id).slice(0, 100)
    return respond<T>({ items } as T)
  }

  const contactUnsubMatch = pathname.match(/^\/contacts\/(\d+)\/unsubscribe$/)
  if (contactUnsubMatch && method === 'POST') {
    const id = Number(contactUnsubMatch[1])
    const contact = store.contacts.find((c) => c.id === id)
    if (!contact) throw apiError('Contact not found', 404)
    contact.status = 'unsubscribed'
    contact.unsubscribedAt = nowIso()
    contact.updatedAt = nowIso()
    for (const send of store.sends) {
      if (send.contactId === id && send.status === 'queued') {
        send.status = 'skipped'
        send.error = 'contact marked from dashboard'
      }
    }
    recordEvent(store, {
      kind: 'contact.unsubscribed',
      contactId: contact.id,
      message: `Unsubscribed ${contact.email}`,
      meta: { email: contact.email },
    })
    recomputeListCounts(store)
    return respond<T>(contact as T)
  }

  const contactResubMatch = pathname.match(/^\/contacts\/(\d+)\/resubscribe$/)
  if (contactResubMatch && method === 'POST') {
    const id = Number(contactResubMatch[1])
    const contact = store.contacts.find((c) => c.id === id)
    if (!contact) throw apiError('Contact not found', 404)
    contact.status = 'subscribed'
    contact.unsubscribedAt = null
    contact.updatedAt = nowIso()
    recordEvent(store, {
      kind: 'contact.subscribed',
      contactId: contact.id,
      message: `Resubscribed ${contact.email}`,
      meta: { email: contact.email },
    })
    recomputeListCounts(store)
    return respond<T>(contact as T)
  }

  /* ── Templates ────────────────────────────────────────────────────────── */

  if (pathname === '/templates' && method === 'GET') {
    const q = (params.get('q') || '').toLowerCase().trim()
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 50)
    let items = [...store.templates]
    if (q) items = items.filter((t) => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    return respond<T>(paginate(items, page, perPage) as T)
  }

  if (pathname === '/templates' && method === 'POST') {
    const name = (body.name || '').trim()
    if (!name) throw apiError('Template name is required', 400)
    if (store.templates.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      throw apiError(`A template called “${name}” already exists`, 409)
    }
    const html = sanitizeEmailHtml(body.html || '')
    const nextId = Math.max(0, ...store.templates.map((t) => t.id)) + 1
    const newTemplate: TemplateDto = {
      id: nextId,
      name,
      subject: (body.subject || '').trim(),
      preheader: (body.preheader || '').trim(),
      html,
      text: (body.text || '').trim() || htmlToText(html),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    store.templates.unshift(newTemplate)
    return respond<T>(newTemplate as T)
  }

  if (pathname === '/templates/preview' && method === 'POST') {
    const sample = body.sample || {}
    const contact = sampleContact(sample)
    const ctx = {
      contact,
      campaign: { name: String(sample.campaign || 'Preview') },
      unsubscribeUrl: 'https://example.com/t/u/preview',
    }
    const html = render(body.html || '', ctx)
    const text = render(body.text || htmlToText(html), ctx)
    const issues = [
      ...analyze(body.subject || '', ctx).unknown,
      ...analyze(body.html || '', ctx).unknown,
      ...analyze(body.text || '', ctx).unknown,
    ].filter((value, index, all) => all.indexOf(value) === index)

    return respond<T>({
      subject: render(body.subject || '', ctx),
      preheader: render(body.preheader || '', ctx),
      html: sanitizeEmailHtml(html),
      text,
      issues,
    } as T)
  }

  const templateMatch = pathname.match(/^\/templates\/(\d+)$/)
  if (templateMatch && method === 'GET') {
    const id = Number(templateMatch[1])
    const template = store.templates.find((t) => t.id === id)
    if (!template) throw apiError('Template not found', 404)
    return respond<T>(template as T)
  }

  if (templateMatch && method === 'PATCH') {
    const id = Number(templateMatch[1])
    const template = store.templates.find((t) => t.id === id)
    if (!template) throw apiError('Template not found', 404)

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (name.toLowerCase() !== template.name.toLowerCase() && store.templates.some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
        throw apiError(`A template called “${name}” already exists`, 409)
      }
      template.name = name
    }
    if (body.subject !== undefined) template.subject = body.subject.trim()
    if (body.preheader !== undefined) template.preheader = body.preheader.trim()
    if (body.html !== undefined) template.html = sanitizeEmailHtml(body.html)
    if (body.text !== undefined) template.text = body.text.trim() || htmlToText(template.html)
    template.updatedAt = nowIso()
    return respond<T>(template as T)
  }

  if (templateMatch && method === 'DELETE') {
    const id = Number(templateMatch[1])
    const index = store.templates.findIndex((t) => t.id === id)
    if (index === -1) throw apiError('Template not found', 404)
    store.templates.splice(index, 1)
    return respond<T>({ ok: true } as T)
  }

  const templateDupMatch = pathname.match(/^\/templates\/(\d+)\/duplicate$/)
  if (templateDupMatch && method === 'POST') {
    const id = Number(templateDupMatch[1])
    const source = store.templates.find((t) => t.id === id)
    if (!source) throw apiError('Template not found', 404)
    const base = `${source.name} copy`
    let name = base
    let n = 2
    while (store.templates.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      name = `${base} ${n++}`
    }
    const nextId = Math.max(0, ...store.templates.map((t) => t.id)) + 1
    const copy: TemplateDto = {
      ...source,
      id: nextId,
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    store.templates.unshift(copy)
    return respond<T>(copy as T)
  }

  const templateTestMatch = pathname.match(/^\/templates\/(\d+)\/test$/)
  if (templateTestMatch && method === 'POST') {
    const id = Number(templateTestMatch[1])
    const template = store.templates.find((t) => t.id === id)
    if (!template) throw apiError('Template not found', 404)
    const testEmail = (body.email || '').trim()

    const ctx = {
      contact: sampleContact({ email: testEmail }),
      campaign: { name: template.name },
      unsubscribeUrl: 'https://example.com/t/u/demo',
      now: new Date(),
    }
    const renderedHtml = render(template.html, ctx)
    const renderedSubject = render(template.subject || 'Template preview', ctx)
    const renderedText = render(template.text || htmlToText(renderedHtml), ctx)

    const nextMailboxId = Math.max(0, ...store.mailbox.map((m) => m.id)) + 1
    const messageId = `test-${Date.now()}@demo.local`
    store.mailbox.unshift({
      id: nextMailboxId,
      toEmail: testEmail,
      toName: 'Test Recipient',
      fromEmail: store.settings.fromEmail,
      fromName: store.settings.fromName,
      replyTo: store.settings.replyTo,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
      headers: { 'message-id': `<${messageId}>`, 'to': testEmail, 'from': store.settings.fromEmail, 'subject': renderedSubject },
      messageId,
      sendId: null,
      campaignId: null,
      emlPath: null,
      simulatedOpenAt: null,
      createdAt: nowIso(),
    })

    recordEvent(store, {
      kind: 'test.sent',
      message: `Test email: ${renderedSubject} → ${testEmail}`,
      meta: { email: testEmail, templateId: template.id },
    })

    return respond<T>({ ok: true, transport: 'memory', mailboxId: nextMailboxId } as T)
  }

  /* ── Campaigns ────────────────────────────────────────────────────────── */

  if (pathname === '/campaigns' && method === 'GET') {
    const status = params.get('status')
    const q = (params.get('q') || '').toLowerCase().trim()
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 25)

    let items = [...store.campaigns]
    if (status && status !== 'all') {
      items = items.filter((c) => c.status === status)
    }
    if (q) {
      items = items.filter((c) => c.name.toLowerCase().includes(q))
    }
    for (const c of items) {
      c.stats = recomputeCampaignStats(c.id, store)
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    return respond<T>(paginate(items, page, perPage) as T)
  }

  if (pathname === '/campaigns/estimate' && method === 'POST') {
    const segment = (body.segment || body) as Segment
    const matching = store.contacts.filter((c) => matchesSegment(c, segment))
    return respond<T>({
      recipients: matching.length,
      sample: matching.slice(0, 5).map((c) => ({ id: c.id, email: c.email, name: c.name })),
    } as T)
  }

  if (pathname === '/campaigns' && method === 'POST') {
    const name = (body.name || '').trim()
    if (!name) throw apiError('Campaign name is required', 400)
    const type: CampaignType = body.type || 'broadcast'
    const nextCampaignId = Math.max(0, ...store.campaigns.map((c) => c.id)) + 1
    const segment: Segment = body.segment || { listIds: [], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }
    const schedule: CampaignSchedule = {
      startAt: body.scheduledStartAt || null,
      timezone: body.schedule?.timezone || store.settings.sending.timezone || 'UTC',
      windowStartHour: body.schedule?.windowStartHour ?? store.settings.sending.windowStartHour,
      windowEndHour: body.schedule?.windowEndHour ?? store.settings.sending.windowEndHour,
      ratePerMinute: body.schedule?.ratePerMinute ?? store.settings.sending.ratePerMinute ?? 30,
      dailyCap: body.schedule?.dailyCap ?? store.settings.sending.dailyCap ?? 2000,
      skipWeekends: body.schedule?.skipWeekends ?? false,
    }
    const tracking: CampaignTracking = {
      openTracking: body.tracking?.openTracking ?? store.settings.tracking.openTracking ?? true,
      clickTracking: body.tracking?.clickTracking ?? store.settings.tracking.clickTracking ?? true,
      includeUnsubscribe: body.tracking?.includeUnsubscribe ?? store.settings.tracking.includeUnsubscribe ?? true,
    }

    const rawSteps: StepDto[] = Array.isArray(body.steps) && body.steps.length
      ? body.steps.map((s: Partial<StepDto>, idx: number) => {
          const html = sanitizeEmailHtml(s.html || '')
          return {
            id: s.id || idx + 1,
            campaignId: nextCampaignId,
            position: idx,
            name: s.name || `Email ${idx + 1}`,
            templateId: s.templateId ?? null,
            subject: (s.subject || '').trim(),
            preheader: (s.preheader || '').trim(),
            html,
            text: (s.text || '').trim() || htmlToText(html),
            delayMinutes: Math.max(0, Number(s.delayMinutes || 0)),
            skipIfOpened: Boolean(s.skipIfOpened),
            skipIfClicked: Boolean(s.skipIfClicked),
          }
        })
      : [
          {
            id: 1,
            campaignId: nextCampaignId,
            position: 0,
            name: 'Email 1',
            templateId: null,
            subject: '',
            preheader: '',
            html: '',
            text: '',
            delayMinutes: 0,
            skipIfOpened: false,
            skipIfClicked: false,
          },
        ]

    const recipientCount = store.contacts.filter((c) => matchesSegment(c, segment)).length

    const newCampaign: CampaignDto = {
      id: nextCampaignId,
      name,
      type,
      status: 'draft',
      fromName: (body.fromName || '').trim() || store.settings.fromName,
      fromEmail: (body.fromEmail || '').trim() || store.settings.fromEmail,
      replyTo: body.replyTo !== undefined ? (body.replyTo || '').trim() : store.settings.replyTo,
      subject: rawSteps[0]?.subject || '',
      segment,
      schedule,
      tracking,
      scheduledStartAt: schedule.startAt || null,
      startedAt: null,
      completedAt: null,
      recipientCount,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      steps: rawSteps,
      stats: {
        recipients: recipientCount,
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
      },
    }

    store.campaigns.unshift(newCampaign)
    recordEvent(store, {
      kind: 'campaign.created',
      campaignId: newCampaign.id,
      message: `Draft “${name}” created`,
      meta: { campaignName: name },
    })

    return respond<T>(newCampaign as T)
  }

  const campaignMatch = pathname.match(/^\/campaigns\/(\d+)$/)
  if (campaignMatch && method === 'GET') {
    const id = Number(campaignMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  if (campaignMatch && method === 'PATCH') {
    const id = Number(campaignMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)

    if (body.name !== undefined) campaign.name = body.name.trim()
    if (body.type !== undefined) campaign.type = body.type
    if (body.fromName !== undefined) campaign.fromName = body.fromName.trim()
    if (body.fromEmail !== undefined) campaign.fromEmail = body.fromEmail.trim()
    if (body.replyTo !== undefined) campaign.replyTo = body.replyTo.trim()
    if (body.segment !== undefined) campaign.segment = { ...campaign.segment, ...body.segment }
    if (body.schedule !== undefined) campaign.schedule = { ...campaign.schedule, ...body.schedule }
    if (body.tracking !== undefined) campaign.tracking = { ...campaign.tracking, ...body.tracking }
    if (body.scheduledStartAt !== undefined) {
      campaign.scheduledStartAt = body.scheduledStartAt
      campaign.schedule.startAt = body.scheduledStartAt
    }
    if (Array.isArray(body.steps)) {
      campaign.steps = body.steps.map((s: Partial<StepDto>, idx: number) => {
        const html = sanitizeEmailHtml(s.html || '')
        return {
          id: s.id || idx + 1,
          campaignId: campaign.id,
          position: idx,
          name: s.name || `Email ${idx + 1}`,
          templateId: s.templateId ?? null,
          subject: (s.subject || '').trim(),
          preheader: (s.preheader || '').trim(),
          html,
          text: (s.text || '').trim() || htmlToText(html),
          delayMinutes: Math.max(0, Number(s.delayMinutes || 0)),
          skipIfOpened: Boolean(s.skipIfOpened),
          skipIfClicked: Boolean(s.skipIfClicked),
        }
      })
      campaign.subject = campaign.steps[0]?.subject || ''
    }
    campaign.recipientCount = store.contacts.filter((c) => matchesSegment(c, campaign.segment)).length
    campaign.updatedAt = nowIso()
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  if (campaignMatch && method === 'DELETE') {
    const id = Number(campaignMatch[1])
    const index = store.campaigns.findIndex((c) => c.id === id)
    if (index === -1) throw apiError('Campaign not found', 404)
    store.campaigns.splice(index, 1)
    store.sends = store.sends.filter((s) => s.campaignId !== id)
    return respond<T>({ ok: true } as T)
  }

  const campaignDupMatch = pathname.match(/^\/campaigns\/(\d+)\/duplicate$/)
  if (campaignDupMatch && method === 'POST') {
    const id = Number(campaignDupMatch[1])
    const source = store.campaigns.find((c) => c.id === id)
    if (!source) throw apiError('Campaign not found', 404)
    const nextCampaignId = Math.max(0, ...store.campaigns.map((c) => c.id)) + 1
    const copy: CampaignDto = {
      ...clone(source),
      id: nextCampaignId,
      name: `${source.name} copy`,
      status: 'draft',
      scheduledStartAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      steps: source.steps.map((s, idx) => ({ ...s, id: idx + 1, campaignId: nextCampaignId })),
      stats: {
        recipients: source.recipientCount,
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
      },
    }
    store.campaigns.unshift(copy)
    return respond<T>(copy as T)
  }

  const campaignValidateMatch = pathname.match(/^\/campaigns\/(\d+)\/validate$/)
  if (campaignValidateMatch && method === 'POST') {
    const id = Number(campaignValidateMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    campaign.recipientCount = store.contacts.filter((c) => matchesSegment(c, campaign.segment)).length
    const problems = validateCampaign(campaign)
    return respond<T>({ ready: problems.length === 0, problems } as T)
  }

  const campaignStartMatch = pathname.match(/^\/campaigns\/(\d+)\/start$/)
  if (campaignStartMatch && method === 'POST') {
    const id = Number(campaignStartMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)

    campaign.recipientCount = store.contacts.filter((c) => matchesSegment(c, campaign.segment)).length
    const problems = validateCampaign(campaign)
    if (problems.length) throw apiError(problems[0]!, 400, problems.map((p) => ({ path: '', message: p })))

    const base = body.at ? new Date(body.at) : campaign.scheduledStartAt ? new Date(campaign.scheduledStartAt) : new Date()
    const future = base.getTime() > Date.now() + 1000

    campaign.status = future ? 'scheduled' : 'running'
    campaign.scheduledStartAt = base.toISOString()
    campaign.startedAt = future ? null : nowIso()
    campaign.completedAt = null
    campaign.updatedAt = nowIso()

    // Enqueue sends
    const recipients = store.contacts.filter((c) => matchesSegment(c, campaign.segment))
    let cumulative = 0
    let queuedCount = 0

    for (const step of campaign.steps) {
      cumulative += step.delayMinutes
      const sendAfter = new Date(base.getTime() + cumulative * 60_000).toISOString()
      for (const r of recipients) {
        const existing = store.sends.find((s) => s.campaignId === campaign.id && s.stepId === step.id && s.contactId === r.id)
        if (!existing) {
          const nextSendId = Math.max(0, ...store.sends.map((s) => s.id)) + 1
          store.sends.push({
            id: nextSendId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            stepId: step.id,
            stepName: step.name,
            contactId: r.id,
            contactEmail: r.email,
            subject: step.subject || campaign.name,
            status: 'queued',
            attempts: 0,
            error: null,
            messageId: null,
            transport: 'memory',
            sendAfter,
            sentAt: null,
            openedAt: null,
            clickedAt: null,
            openCount: 0,
            clickCount: 0,
          })
          queuedCount++
        }
      }
    }

    recordEvent(store, {
      kind: 'campaign.started',
      campaignId: campaign.id,
      message: future ? `Scheduled — ${queuedCount} message(s) queued for ${base.toISOString()}` : `Started — ${queuedCount} message(s) queued`,
      meta: { queued: queuedCount, scheduled: future, campaignName: campaign.name },
    })

    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  const campaignPauseMatch = pathname.match(/^\/campaigns\/(\d+)\/pause$/)
  if (campaignPauseMatch && method === 'POST') {
    const id = Number(campaignPauseMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    campaign.status = 'paused'
    campaign.updatedAt = nowIso()
    recordEvent(store, { kind: 'campaign.paused', campaignId: id, message: 'Paused', meta: { campaignName: campaign.name } })
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  const campaignResumeMatch = pathname.match(/^\/campaigns\/(\d+)\/resume$/)
  if (campaignResumeMatch && method === 'POST') {
    const id = Number(campaignResumeMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    campaign.status = 'running'
    campaign.updatedAt = nowIso()
    recordEvent(store, { kind: 'campaign.resumed', campaignId: id, message: 'Resumed', meta: { campaignName: campaign.name } })
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  const campaignCancelMatch = pathname.match(/^\/campaigns\/(\d+)\/cancel$/)
  if (campaignCancelMatch && method === 'POST') {
    const id = Number(campaignCancelMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    campaign.status = 'canceled'
    campaign.completedAt = nowIso()
    campaign.updatedAt = nowIso()
    for (const send of store.sends) {
      if (send.campaignId === id && (send.status === 'queued' || send.status === 'sending')) {
        send.status = 'skipped'
        send.error = 'campaign canceled'
      }
    }
    recordEvent(store, { kind: 'campaign.canceled', campaignId: id, message: 'Canceled — remaining messages skipped', meta: { campaignName: campaign.name } })
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>(campaign as T)
  }

  const campaignRetryMatch = pathname.match(/^\/campaigns\/(\d+)\/retry-failed$/)
  if (campaignRetryMatch && method === 'POST') {
    const id = Number(campaignRetryMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    let retried = 0
    for (const send of store.sends) {
      if (send.campaignId === id && (send.status === 'failed' || send.status === 'bounced')) {
        send.status = 'queued'
        send.attempts = 0
        send.error = null
        send.sendAfter = nowIso()
        retried++
      }
    }
    if (retried > 0 && campaign.status === 'completed') {
      campaign.status = 'running'
      campaign.completedAt = null
      campaign.updatedAt = nowIso()
    }
    campaign.stats = recomputeCampaignStats(campaign.id, store)
    return respond<T>({ ok: true, retried, campaign } as T)
  }

  const campaignSendTestMatch = pathname.match(/^\/campaigns\/(\d+)\/send-test$/)
  if (campaignSendTestMatch && method === 'POST') {
    const id = Number(campaignSendTestMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    const testEmail = (body.email || '').trim()
    const step = body.stepId ? campaign.steps.find((s) => s.id === Number(body.stepId)) : campaign.steps[0]
    if (!step) throw apiError('This campaign has no email steps yet', 404)

    const ctx = {
      contact: sampleContact({ email: testEmail }),
      campaign: { name: campaign.name },
      unsubscribeUrl: 'https://example.com/t/u/demo',
      now: new Date(),
    }
    const renderedHtml = render(step.html, ctx)
    const renderedSubject = render(step.subject || campaign.name, ctx)
    const renderedText = render(step.text || htmlToText(renderedHtml), ctx)

    const nextMailboxId = Math.max(0, ...store.mailbox.map((m) => m.id)) + 1
    const messageId = `test-${Date.now()}@demo.local`
    store.mailbox.unshift({
      id: nextMailboxId,
      toEmail: testEmail,
      toName: 'Test Recipient',
      fromEmail: campaign.fromEmail,
      fromName: campaign.fromName,
      replyTo: campaign.replyTo,
      subject: renderedSubject,
      html: renderedHtml,
      text: renderedText,
      headers: { 'message-id': `<${messageId}>`, 'to': testEmail, 'from': campaign.fromEmail, 'subject': renderedSubject },
      messageId,
      sendId: null,
      campaignId: campaign.id,
      emlPath: null,
      simulatedOpenAt: null,
      createdAt: nowIso(),
    })

    recordEvent(store, {
      kind: 'test.sent',
      message: `Test email: ${renderedSubject} → ${testEmail}`,
      meta: { email: testEmail, campaignId: campaign.id },
    })

    return respond<T>({ ok: true, transport: 'memory', subject: renderedSubject } as T)
  }

  const campaignStatsMatch = pathname.match(/^\/campaigns\/(\d+)\/stats$/)
  if (campaignStatsMatch && method === 'GET') {
    const id = Number(campaignStatsMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    return respond<T>({
      stats: recomputeCampaignStats(id, store),
      funnel: funnelFor(id, store),
    } as T)
  }

  const campaignSeriesMatch = pathname.match(/^\/campaigns\/(\d+)\/series$/)
  if (campaignSeriesMatch && method === 'GET') {
    const id = Number(campaignSeriesMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    const hours = Math.min(168, Math.max(1, Number(params.get('hours') || 24)))
    return respond<T>({ points: seriesFor(id, store, hours) } as T)
  }

  const campaignFunnelMatch = pathname.match(/^\/campaigns\/(\d+)\/funnel$/)
  if (campaignFunnelMatch && method === 'GET') {
    const id = Number(campaignFunnelMatch[1])
    return respond<T>({ points: funnelFor(id, store) } as T)
  }

  const campaignSendsMatch = pathname.match(/^\/campaigns\/(\d+)\/sends$/)
  if (campaignSendsMatch && method === 'GET') {
    const campaignId = Number(campaignSendsMatch[1])
    const status = params.get('status')
    const stepId = params.get('stepId') ? Number(params.get('stepId')) : undefined
    const q = (params.get('q') || '').toLowerCase().trim()
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 25)

    let items = store.sends.filter((s) => s.campaignId === campaignId)
    if (status && status !== 'all') items = items.filter((s) => s.status === status)
    if (stepId) items = items.filter((s) => s.stepId === stepId)
    if (q) items = items.filter((s) => s.contactEmail.toLowerCase().includes(q))
    items.sort((a, b) => new Date(b.sendAfter).getTime() - new Date(a.sendAfter).getTime() || b.id - a.id)
    return respond<T>(paginate(items, page, perPage) as T)
  }

  const campaignEventsMatch = pathname.match(/^\/campaigns\/(\d+)\/events$/)
  if (campaignEventsMatch && method === 'GET') {
    const id = Number(campaignEventsMatch[1])
    const items = store.events.filter((e) => e.campaignId === id).slice(0, 100)
    return respond<T>({ items } as T)
  }

  const campaignStepsMatch = pathname.match(/^\/campaigns\/(\d+)\/steps$/)
  if (campaignStepsMatch && method === 'POST') {
    const id = Number(campaignStepsMatch[1])
    const campaign = store.campaigns.find((c) => c.id === id)
    if (!campaign) throw apiError('Campaign not found', 404)
    const html = sanitizeEmailHtml(body.html || '')
    const position = campaign.steps.length
    const nextStepId = Math.max(0, ...campaign.steps.map((s) => s.id)) + 1
    const newStep: StepDto = {
      id: nextStepId,
      campaignId: id,
      position,
      name: (body.name || '').trim() || `Email ${position + 1}`,
      templateId: body.templateId ?? null,
      subject: (body.subject || '').trim(),
      preheader: (body.preheader || '').trim(),
      html,
      text: (body.text || '').trim() || htmlToText(html),
      delayMinutes: Math.max(0, Number(body.delayMinutes || 0)),
      skipIfOpened: Boolean(body.skipIfOpened),
      skipIfClicked: Boolean(body.skipIfClicked),
    }
    campaign.steps.push(newStep)
    campaign.updatedAt = nowIso()
    return respond<T>(newStep as T)
  }

  const campaignStepMatch = pathname.match(/^\/campaigns\/(\d+)\/steps\/(\d+)$/)
  if (campaignStepMatch && method === 'PATCH') {
    const campaignId = Number(campaignStepMatch[1])
    const stepId = Number(campaignStepMatch[2])
    const campaign = store.campaigns.find((c) => c.id === campaignId)
    if (!campaign) throw apiError('Campaign not found', 404)
    const step = campaign.steps.find((s) => s.id === stepId)
    if (!step) throw apiError('Step not found', 404)

    if (body.name !== undefined) step.name = body.name.trim()
    if (body.templateId !== undefined) step.templateId = body.templateId
    if (body.subject !== undefined) step.subject = body.subject.trim()
    if (body.preheader !== undefined) step.preheader = body.preheader.trim()
    if (body.html !== undefined) step.html = sanitizeEmailHtml(body.html)
    if (body.text !== undefined) step.text = body.text.trim() || htmlToText(step.html)
    if (body.delayMinutes !== undefined) step.delayMinutes = Math.max(0, Number(body.delayMinutes))
    if (body.skipIfOpened !== undefined) step.skipIfOpened = Boolean(body.skipIfOpened)
    if (body.skipIfClicked !== undefined) step.skipIfClicked = Boolean(body.skipIfClicked)
    campaign.updatedAt = nowIso()
    return respond<T>(step as T)
  }

  if (campaignStepMatch && method === 'DELETE') {
    const campaignId = Number(campaignStepMatch[1])
    const stepId = Number(campaignStepMatch[2])
    const campaign = store.campaigns.find((c) => c.id === campaignId)
    if (!campaign) throw apiError('Campaign not found', 404)
    const index = campaign.steps.findIndex((s) => s.id === stepId)
    if (index === -1) throw apiError('Step not found', 404)
    campaign.steps.splice(index, 1)
    campaign.steps.forEach((s, i) => { s.position = i })
    campaign.updatedAt = nowIso()
    return respond<T>({ ok: true } as T)
  }

  const campaignStepMoveMatch = pathname.match(/^\/campaigns\/(\d+)\/steps\/(\d+)\/move$/)
  if (campaignStepMoveMatch && method === 'POST') {
    const campaignId = Number(campaignStepMoveMatch[1])
    const stepId = Number(campaignStepMoveMatch[2])
    const campaign = store.campaigns.find((c) => c.id === campaignId)
    if (!campaign) throw apiError('Campaign not found', 404)
    const index = campaign.steps.findIndex((s) => s.id === stepId)
    const direction = body.direction === 'up' ? -1 : 1
    const target = index + direction
    if (index >= 0 && target >= 0 && target < campaign.steps.length) {
      const temp = campaign.steps[index]!
      campaign.steps[index] = campaign.steps[target]!
      campaign.steps[target] = temp
      campaign.steps.forEach((s, i) => { s.position = i })
      campaign.updatedAt = nowIso()
    }
    return respond<T>(campaign as T)
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */

  if (pathname === '/settings' && method === 'GET') {
    return respond<T>(store.settings as T)
  }

  if (pathname === '/settings' && method === 'PUT') {
    store.settings = {
      ...store.settings,
      ...body,
      smtp: { ...store.settings.smtp, ...(body.smtp || {}) },
      sending: { ...store.settings.sending, ...(body.sending || {}) },
      tracking: { ...store.settings.tracking, ...(body.tracking || {}) },
    }
    recordEvent(store, { kind: 'contact.subscribed', message: 'Workspace settings updated' })
    return respond<T>(store.settings as T)
  }

  if (pathname === '/settings/smtp/test' && method === 'POST') {
    return respond<T>({ ok: true, transport: 'memory', message: 'Demo mode: memory transport active' } as T)
  }

  /* ── Stats & Activity ─────────────────────────────────────────────────── */

  if (pathname === '/stats/dashboard' && method === 'GET') {
    const audience = audienceTotals(store)
    const sentSends = store.sends.filter((s) => s.status === 'sent')
    const queuedSends = store.sends.filter((s) => s.status === 'queued' || s.status === 'sending')
    const todayStr = new Date().toISOString().slice(0, 10)
    const sentToday = sentSends.filter((s) => s.sentAt && s.sentAt.slice(0, 10) === todayStr).length
    const uniqueOpens = store.sends.filter((s) => (s.openCount ?? 0) > 0).length
    const uniqueClicks = store.sends.filter((s) => (s.clickCount ?? 0) > 0).length
    const sentTotal = sentSends.length

    const running = store.campaigns.filter((c) => c.status === 'running').length
    const scheduled = store.campaigns.filter((c) => c.status === 'scheduled').length

    const topCampaigns = store.campaigns
      .map((c) => {
        const cSends = store.sends.filter((s) => s.campaignId === c.id)
        const cSent = cSends.filter((s) => s.status === 'sent').length
        const cOpens = cSends.filter((s) => (s.openCount ?? 0) > 0).length
        const cClicks = cSends.filter((s) => (s.clickCount ?? 0) > 0).length
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          sent: cSent,
          recipients: cSends.length,
          openRate: cSent ? Math.round((cOpens / cSent) * 1000) / 10 : 0,
          clickRate: cSent ? Math.round((cClicks / cSent) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 6)

    const dashboard = {
      totals: {
        contacts: audience.contacts,
        subscribed: audience.subscribed,
        unsubscribed: audience.unsubscribed,
        bounced: audience.bounced,
        lists: store.lists.filter((l) => !l.archived).length,
        templates: store.templates.length,
        campaignsRunning: running,
        campaignsScheduled: scheduled,
        queued: queuedSends.length,
        sentToday,
        sent: sentTotal,
        opens: uniqueOpens,
        clicks: uniqueClicks,
        openRate: sentTotal ? Math.round((uniqueOpens / sentTotal) * 1000) / 10 : 0,
        clickRate: sentTotal ? Math.round((uniqueClicks / sentTotal) * 1000) / 10 : 0,
      },
      series: dashboardSeries(store, 24),
      topCampaigns,
      recentEvents: store.events.slice(0, 14),
      engine: {
        running: store.engine.running,
        tickMs: 1000,
        queueDepth: queuedSends.length,
        lastTickAt: store.engine.lastTickAt,
        tickDurationMs: store.engine.tickDurationMs || 2,
        transport: 'memory' as const,
        activeCampaigns: running + scheduled,
      },
    }

    return respond<T>(dashboard as T)
  }

  if (pathname === '/stats/growth' && method === 'GET') {
    const days = Math.min(90, Math.max(7, Number(params.get('days') || 14)))
    return respond<T>({ points: growthSeries(store, days) } as T)
  }

  if (pathname === '/stats/contacts' && method === 'GET') {
    return respond<T>(audienceTotals(store) as T)
  }

  const statCampMatch = pathname.match(/^\/stats\/campaigns\/(\d+)$/)
  if (statCampMatch && method === 'GET') {
    const id = Number(statCampMatch[1])
    return respond<T>(recomputeCampaignStats(id, store) as T)
  }

  if (pathname === '/activity' && method === 'GET') {
    const limit = Math.min(200, Math.max(5, Number(params.get('limit') || 40)))
    return respond<T>({ items: store.events.slice(0, limit) } as T)
  }

  /* ── Mailbox ──────────────────────────────────────────────────────────── */

  if (pathname === '/mailbox' && method === 'GET') {
    const q = (params.get('q') || '').toLowerCase().trim()
    const campaignId = params.get('campaignId') ? Number(params.get('campaignId')) : undefined
    const page = Number(params.get('page') || 1)
    const perPage = Number(params.get('perPage') || 20)

    let items = [...store.mailbox]
    if (campaignId) items = items.filter((m) => m.campaignId === campaignId)
    if (q) items = items.filter((m) => m.toEmail.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q))
    items.sort((a, b) => b.id - a.id)
    return respond<T>(paginate(items, page, perPage) as T)
  }

  if (pathname === '/mailbox' && method === 'DELETE') {
    const removed = store.mailbox.length
    store.mailbox = []
    return respond<T>({ ok: true, removed } as T)
  }

  const mailboxMatch = pathname.match(/^\/mailbox\/(\d+)$/)
  if (mailboxMatch && method === 'GET') {
    const id = Number(mailboxMatch[1])
    const message = store.mailbox.find((m) => m.id === id)
    if (!message) throw apiError('Message not found', 404)
    return respond<T>(message as T)
  }

  const mailboxRawMatch = pathname.match(/^\/mailbox\/(\d+)\/raw$/)
  if (mailboxRawMatch && method === 'GET') {
    const id = Number(mailboxRawMatch[1])
    const message = store.mailbox.find((m) => m.id === id)
    if (!message) throw apiError('Message not found', 404)
    const raw = `From: "${message.fromName}" <${message.fromEmail}>\r\nTo: "${message.toName}" <${message.toEmail}>\r\nSubject: ${message.subject}\r\nMessage-ID: <${message.messageId || ''}>\r\n\r\n${message.text || message.html}`
    return raw as unknown as T
  }

  const mailboxSimOpenMatch = pathname.match(/^\/mailbox\/(\d+)\/simulate-open$/)
  if (mailboxSimOpenMatch && method === 'POST') {
    const id = Number(mailboxSimOpenMatch[1])
    const message = store.mailbox.find((m) => m.id === id)
    if (!message) throw apiError('Message not found', 404)
    message.simulatedOpenAt = nowIso()

    if (message.sendId) {
      const send = store.sends.find((s) => s.id === message.sendId)
      if (send) {
        send.openCount = (send.openCount || 0) + 1
        send.openedAt = send.openedAt || nowIso()
        if (send.contactId) {
          const contact = store.contacts.find((c) => c.id === send.contactId)
          if (contact) {
            contact.openCount = (contact.openCount || 0) + 1
            contact.lastOpenAt = nowIso()
            contact.updatedAt = nowIso()
          }
        }
      }
      recordEvent(store, {
        kind: 'contact.opened',
        campaignId: send?.campaignId ?? message.campaignId,
        contactId: send?.contactId,
        sendId: message.sendId,
        message: `Opened (simulated): ${message.toEmail}`,
        meta: { email: message.toEmail, simulated: true },
      })
    }

    return respond<T>({
      ok: true,
      message,
      stats: message.campaignId ? recomputeCampaignStats(message.campaignId, store) : null,
    } as T)
  }

  /* ── Engine Controls ──────────────────────────────────────────────────── */

  if (pathname === '/engine' && method === 'GET') {
    const queueDepth = store.sends.filter((s) => s.status === 'queued' || s.status === 'sending').length
    return respond<T>({
      running: store.engine.running,
      tickMs: 1000,
      queueDepth,
      transport: 'memory' as const,
      lastTickAt: store.engine.lastTickAt,
      tickDurationMs: store.engine.tickDurationMs || 2,
      lifetime: store.engine.lifetime,
      limits: {
        dailyCap: store.settings.sending.dailyCap,
        ratePerMinute: store.settings.sending.ratePerMinute,
        maxAttempts: store.settings.sending.maxAttempts,
      },
    } as T)
  }

  if (pathname === '/engine/tick' && method === 'POST') {
    const result = simulateTick(store)
    return respond<T>(result as T)
  }

  if (pathname === '/engine/drain' && method === 'POST') {
    const maxRounds = Math.min(400, Math.max(1, Number(body.maxRounds || 60)))
    const result = simulateDrain(store, maxRounds)
    return respond<T>(result as T)
  }

  throw apiError(`Cannot ${method} ${pathname}`, 404)
}
