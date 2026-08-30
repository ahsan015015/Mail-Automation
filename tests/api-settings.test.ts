import { beforeAll, describe, expect, it } from 'vitest'
import { bootWorkspace, drainQueue, type Workspace } from './helpers.js'

let ws: Workspace

beforeAll(async () => {
  ws = await bootWorkspace()
  await ws.api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ email: 'ops@demo.test', name: 'Ops', password: 'workspace-pass-1' }) })
})

describe('workspace settings', () => {
  it('returns a masked view and never leaks the SMTP password', async () => {
    const before = await ws.api('/api/settings')
    expect(before.status).toBe(200)
    expect(before.body.smtp).not.toHaveProperty('password')
    expect(before.body.smtp.hasPassword).toBe(false)
    expect(before.body.transport).toBe('auto')
    expect(before.body.sending.ratePerMinute).toBeGreaterThan(0)
  })

  it('stores credentials, keeps them on partial saves and can rotate them', async () => {
    const saved = await ws.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ fromEmail: 'hello@demo.test', fromName: 'Demo', smtp: { host: 'smtp.demo.test', port: 587, user: 'apikey', password: 'secret-pass' } }),
    })
    expect(saved.status).toBe(200)
    expect(saved.body.smtp.host).toBe('smtp.demo.test')
    expect(saved.body.smtp.hasPassword).toBe(true)
    expect(saved.body.smtp).not.toHaveProperty('password')

    // a save without the password field must not wipe the stored secret
    const again = await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ fromName: 'Demo Updates', smtp: { host: 'smtp.demo.test' } }) })
    expect(again.body.fromName).toBe('Demo Updates')
    expect(again.body.smtp.hasPassword).toBe(true)

    const raw = await ws.api('/api/engine')
    expect(raw.status).toBe(200)
    // 'auto' + a configured host means the engine now targets SMTP
    expect(raw.body.transport).toBe('smtp')
  })

  it('switching to smtp without a host is rejected', async () => {
    const bad = await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ transport: 'smtp', smtp: { host: '' } }) })
    expect(bad.status).toBe(422)
    expect(bad.body.error.issues.some((i: { path: string }) => i.path.includes('host'))).toBe(true)
    expect(bad.body.error.message).toMatch(/host/i)
  })

  it('verifies the active transport', async () => {
    const memory = await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ transport: 'memory' }) })
    expect(memory.status).toBe(200)
    expect(memory.body.transport).toBe('memory')

    const verify = await ws.api('/api/settings/smtp/test', { method: 'POST' })
    expect(verify.status).toBe(200)
    expect(verify.body.ok).toBe(true)
    expect(verify.body.message).toMatch(/Local mailbox/i)

    // 'auto' prefers SMTP as soon as a host exists, and reports a broken handshake
    await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ transport: 'auto', smtp: { host: 'smtp.invalid.test', port: 587 } }) })
    const broken = await ws.api('/api/settings/smtp/test', { method: 'POST' })
    expect(broken.status).toBe(502)
    expect(broken.body.message).toMatch(/handshake failed/i)
    expect((await ws.api('/api/engine')).body.transport).toBe('smtp')

    const restore = await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ transport: 'memory', smtp: { host: '' } }) })
    expect(restore.body.transport).toBe('memory')
  })

  it('sends a test message into the inbox with tracking disabled', async () => {
    await ws.api('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Team' }) })
    await ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'tester@demo.test', name: 'Tester', listIds: [1] }) })
    const template = await ws.api('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Test tpl', subject: 'Hi {{ first_name }}', html: '<p>Body <a href="https://x.test">link</a></p>' }) })
    const test = await ws.api(`/api/templates/${template.body.id}/test`, { method: 'POST', body: JSON.stringify({ email: 'tester@demo.test' }) })
    expect(test.status).toBe(200)
    expect(test.body.ok).toBe(true)
    expect(test.body.mailboxId).toBeTypeOf('number')

    const message = (await ws.api('/api/mailbox')).body.items[0]
    expect(message.subject).toBe('Hi Tester')
    expect(message.html).toContain('https://x.test') // not rewritten for test sends
    expect(message.html).not.toContain('/t/o/')
    expect(message.html).toContain('/t/u/') // unsubscribe still rendered
  })
})

describe('public endpoints', () => {
  let token = ''

  it('renders a subscribe form without authentication', async () => {
    const list = await ws.api('/api/lists/1')
    token = list.body.subscribeToken
    const form = await fetch(`${ws.base}/public/lists/${token}`)
    expect(form.status).toBe(200)
    const html = await form.text()
    expect(html).toContain('<form method="post"')
    expect(html).toContain('Join Team')
  })

  it('accepts form posts and JSON, and dedupes by email', async () => {
    const form = await fetch(`${ws.base}/public/lists/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'signup@demo.test', name: 'Signed Up' }).toString(),
    })
    expect(form.status).toBe(201)
    expect(await form.text()).toContain('you are on the list')

    const json = await fetch(`${ws.base}/public/lists/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: 'api-signup@demo.test', fields: { plan: 'Pro' } }),
    })
    expect(json.status).toBe(201)
    expect(await json.json()).toMatchObject({ ok: true, created: true, email: 'api-signup@demo.test' })

    const again = await fetch(`${ws.base}/public/lists/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: 'API-signup@demo.test', name: 'Renamed' }),
    })
    expect(again.status).toBe(200)
    expect((await again.json()).created).toBe(false)

    const bad = await fetch(`${ws.base}/public/lists/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nope' }) })
    expect(bad.status).toBe(422)
    const unknown = await fetch(`${ws.base}/public/lists/not-a-real-token`)
    expect(unknown.status).toBe(404)
  })

  it('resubscribes a contact who previously opted out', async () => {
    await ws.api('/api/contacts/1/unsubscribe', { method: 'POST' })
    expect((await ws.api('/api/contacts/by-email?email=tester@demo.test')).body.status).toBe('unsubscribed')
    const back = await fetch(`${ws.base}/public/lists/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: 'tester@demo.test' }),
    })
    expect(back.status).toBe(200)
    expect((await ws.api('/api/contacts/by-email?email=tester@demo.test')).body.status).toBe('subscribed')
  })
})

describe('inbox + live stream', () => {
  it('simulates an open from the inbox and updates campaign stats', async () => {
    await ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'inbox@demo.test', name: 'Ina Box', listIds: [1] }) })
    const campaign = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Inbox probe', fromEmail: 'hello@demo.test', segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }, steps: [{ subject: 'Probe', html: '<p>probe</p>' }] }),
    })
    await ws.api(`/api/campaigns/${campaign.body.id}/start`, { method: 'POST', body: JSON.stringify({}) })
    await drainQueue()

    const message = (await ws.api('/api/mailbox?q=inbox@demo.test')).body.items[0]
    expect(message.subject).toBe('Probe')
    const simulated = await ws.api(`/api/mailbox/${message.id}/simulate-open`, { method: 'POST' })
    expect(simulated.status).toBe(200)
    expect(simulated.body.message.simulatedOpenAt).toBeTruthy()
    expect(simulated.body.stats.uniqueOpens).toBe(1)
    expect((await ws.api(`/api/campaigns/${campaign.body.id}`)).body.stats.openRate).toBeGreaterThan(0)
  })

  it('streams events over SSE', async () => {
    await ws.api('/api/settings', { method: 'PUT', body: JSON.stringify({ transport: 'memory' }) })
    const controller = new AbortController()
    const response = await fetch(`${ws.base}/api/stream`, { headers: { Cookie: ws.cookie() }, signal: controller.signal })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(new TextDecoder().decode(await reader.read().then((r) => r.value!))).toContain('event: ready')

    // now trigger something and expect it on the wire
    void ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'stream@demo.test', name: 'Streamer' }) })
    const chunk = decoder.decode((await reader.read()).value ?? new Uint8Array(), { stream: true })
    expect(chunk).toContain('event: event')
    expect(chunk).toContain('Added stream@demo.test')

    await reader.cancel().catch(() => undefined)
    controller.abort()
  })

  it('clears the mailbox', async () => {
    const cleared = await ws.api('/api/mailbox', { method: 'DELETE' })
    expect(cleared.body.removed).toBeGreaterThan(0)
    expect((await ws.api('/api/mailbox')).body.total).toBe(0)
  })
})

describe('campaign guard rails', () => {
  it('blocks structural edits on a live campaign but allows content edits', async () => {
    const created = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Guard rails', fromEmail: 'hello@demo.test', steps: [{ subject: 'A', html: '<p>a</p>', delayMinutes: 0 }, { subject: 'B', html: '<p>b</p>', delayMinutes: 60 }] }),
    })
    const id = created.body.id
    const stepId = created.body.steps[1].id
    await ws.api(`/api/campaigns/${id}/start`, { method: 'POST', body: JSON.stringify({}) })

    const structural = await ws.api(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'renamed while live' }) })
    expect(structural.status).toBe(409)
    expect(structural.body.error.message).toMatch(/read-only/i)

    const content = await ws.api(`/api/campaigns/${id}/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify({ subject: 'B edited' }) })
    expect(content.status).toBe(200)
    expect(content.body.subject).toBe('B edited')

    const removeSent = await ws.api(`/api/campaigns/${id}/steps/${created.body.steps[0].id}`, { method: 'DELETE' })
    expect(removeSent.status).toBeGreaterThanOrEqual(400)

    await ws.api(`/api/campaigns/${id}/pause`, { method: 'POST' })
    const afterPause = await ws.api(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'renamed while paused' }) })
    expect(afterPause.body.name).toBe('renamed while paused')
    expect(afterPause.body.status).toBe('paused')
  })

  it('rejects duplicate names for lists and templates', async () => {
    expect((await ws.api('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Team' }) })).status).toBe(409)
    expect((await ws.api('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Test tpl' }) })).status).toBe(409)
  })

  it('returns a structured 404 for unknown api routes', async () => {
    const missing = await ws.api('/api/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.body.error.message).toContain('/api/does-not-exist')
  })
})
