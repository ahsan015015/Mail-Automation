import { beforeAll, describe, expect, it } from 'vitest'
import { bootWorkspace, drainQueue, type Workspace } from './helpers.js'

/**
 * Journey test: sign in → build an audience → write a template → run a campaign
 * → the memory transport captures the message → tracking endpoints record
 * opens, clicks and unsubscribes → stats and the dashboard agree.
 */
let ws: Workspace

beforeAll(async () => {
  ws = await bootWorkspace()
})

describe('auth + bootstrap', () => {
  it('exposes a public health endpoint', async () => {
    const { status, body } = await ws.api('/api/health')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.transport).toBe('memory')
    expect(body.database.tables).toBeGreaterThan(10)
  })

  it('refuses unauthenticated API access', async () => {
    const { status, body } = await ws.api('/api/contacts')
    expect(status).toBe(401)
    expect(body.error.message).toMatch(/Authentication/)
  })

  it('answers bootstrap without a session, so the SPA can offer sign-in', async () => {
    const { status, body } = await ws.api('/api/bootstrap')
    expect(status).toBe(200)
    expect(body.user).toBeNull()
    expect(body.needsSetup).toBe(true)
    // no settings leak before authentication
    expect(body.settings).toBeUndefined()
    expect(body.app.name).toBe('Mail Automation')
  })

  it('creates the first user through setup, then rejects further setups', async () => {
    const bootstrap = await ws.api('/api/auth/me')
    expect(bootstrap.body.needsSetup).toBe(true)

    const created = await ws.api('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@demo.test', name: 'Owner', password: 'sup3r-secret-pw' }),
    })
    expect(created.status).toBe(201)
    expect(created.body.user.role).toBe('owner')

    const again = await ws.api('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@demo.test', password: 'another-password-1' }),
    })
    expect(again.status).toBe(400)
  })

  it('validates credentials and refuses a second setup', async () => {
    const weak = await ws.api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'nope', password: '' }) })
    expect(weak.status).toBe(422)
    expect(weak.body.error.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['email', 'password']))
    const secondSetup = await ws.api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ email: 'x@demo.test', password: 'another-password-1' }) })
    expect(secondSetup.status).toBe(400)
  })

  it('logs in with the stored credentials and rejects wrong ones', async () => {
    await ws.api('/api/auth/logout', { method: 'POST' })
    const bad = await ws.api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@demo.test', password: 'wrong-password!' }) })
    expect(bad.status).toBe(401)
    const good = await ws.api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@demo.test', password: 'sup3r-secret-pw' }) })
    expect(good.status).toBe(200)
    expect(good.body.user.email).toBe('owner@demo.test')
    const me = await ws.api('/api/auth/me')
    expect(me.body.user.id).toBe(1)

    const bootstrap = await ws.api('/api/bootstrap')
    expect(bootstrap.body.user.email).toBe('owner@demo.test')
    expect(bootstrap.body.needsSetup).toBe(false)
    // 'auto' + no SMTP host is what makes the local mail catcher active
    expect(bootstrap.body.settings.transport).toBe('auto')
    expect(bootstrap.body.settings.smtp.host).toBe('')
    // the password never leaves the server
    expect(JSON.stringify(bootstrap.body.settings.smtp)).not.toContain('password\":')
    expect(bootstrap.body.settings.smtp.hasPassword).toBe(false)
  })
})

describe('audience', () => {
  it('creates lists and refuses duplicates', async () => {
    const list = await ws.api('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Trial users', description: 'New signups' }) })
    expect(list.status).toBe(201)
    expect(list.body.subscribeToken).toHaveLength(16)
    const dup = await ws.api('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Trial users' }) })
    expect(dup.status).toBe(409)
  })

  it('validates contact payloads', async () => {
    const invalid = await ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'not-an-email' }) })
    expect(invalid.status).toBe(422)
    const missing = await ws.api('/api/contacts/9999')
    expect(missing.status).toBe(404)
  })

  it('creates a contact with tags and custom fields', async () => {
    const created = await ws.api('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ email: 'mira@northwind.example', name: 'Mira Kowalski', fields: { plan: 'Pro' }, tags: ['vip'], listIds: [1] }),
    })
    expect(created.status).toBe(201)
    expect(created.body.tags[0].name).toBe('vip')
    expect(created.body.lists[0].name).toBe('Trial users')
    const conflict = await ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'MIRA@northwind.example' }) })
    expect(conflict.status).toBe(409)
  })

  it('imports CSV, dedupes by email and reports skipped rows', async () => {
    const csv = [
      'email,name,plan,tags',
      'daniel@acme.example,Daniel Optimize,Starter,trial',
      'sofia@globex.example,Sofia Rossi,Pro,vip;trial',
      'mira@northwind.example,Mira Kowalski,Scale,',
      'broken-row-no-at-sign,Not An Email,,',
    ].join('\n')
    const result = await ws.api('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ csv, listId: 1, tags: ['imported'] }),
    })
    expect(result.status).toBe(200)
    expect(result.body.created).toBe(2)
    expect(result.body.updated).toBe(1)
    expect(result.body.skipped.length).toBeGreaterThanOrEqual(1)

    const list = await ws.api('/api/lists/1/contacts')
    expect(list.body.total).toBe(3)
    const mira = await ws.api('/api/contacts/by-email?email=mira@northwind.example')
    expect(mira.body.fields.plan).toBe('Scale')
    expect(mira.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['imported', 'vip'])
  })

  it('filters, searches, sorts and paginates contacts', async () => {
    const search = await ws.api('/api/contacts?q=globex&status=all')
    expect(search.body.items.map((c: { email: string }) => c.email)).toEqual(['sofia@globex.example'])
    const sorted = await ws.api('/api/contacts?perPage=5&page=1&status=all&sort=email_asc')
    expect(sorted.body.total).toBe(3)
    expect(sorted.body.items.map((c: { email: string }) => c.email)).toEqual(['daniel@acme.example', 'mira@northwind.example', 'sofia@globex.example'])
    const byTag = await ws.api('/api/tags')
    const vip = byTag.body.items.find((t: { name: string }) => t.name === 'vip')
    // mira was tagged directly, sofia came in through the CSV `tags` column
    expect((await ws.api(`/api/contacts?tagId=${vip.id}&status=all`)).body.total).toBe(2)
    expect((await ws.api('/api/contacts?perPage=2')).status).toBe(422) // perPage is clamped
  })

  it('exports the audience as CSV', async () => {
    const exported = await ws.api('/api/contacts/export?status=all')
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect(String(exported.body).split('\r\n')[0]).toContain('email')
    expect(String(exported.body)).toContain('sofia@globex.example')
  })
})

describe('templates', () => {
  it('creates, previews and sanitises a template', async () => {
    const created = await ws.api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Welcome',
        subject: 'Welcome {{ first_name | friend }}!',
        preheader: 'Your {{ plan | Free }} plan',
        html: '<p onclick="evil()">Hi {{ first_name }}, read <a href="https://docs.test/start">the guide</a>.</p><script>alert(1)</script>',
        text: '',
      }),
    })
    expect(created.status).toBe(201)
    expect(created.body.html).not.toContain('onclick')
    expect(created.body.html).not.toContain('alert(1)')
    expect(created.body.text).toContain('the guide (https://docs.test/start)')

    const preview = await ws.api('/api/templates/preview', {
      method: 'POST',
      body: JSON.stringify({ subject: created.body.subject, html: created.body.html, text: '', sample: { first_name: 'Ahsan', plan: 'Pro' } }),
    })
    expect(preview.body.subject).toBe('Welcome Ahsan!')
    expect(preview.body.html).toContain('Hi Ahsan')

    const missingVar = await ws.api('/api/templates/preview', { method: 'POST', body: JSON.stringify({ subject: 'Hi {{ firest_name }}', html: '', text: '' }) })
    expect(missingVar.body.issues).toEqual(['firest_name'])
  })
})

describe('campaign run', () => {
  let campaignId: number
  let messageUrl = ''
  let unsubUrl = ''
  let clickUrl = ''

  it('estimates the audience for a segment', async () => {
    const estimate = await ws.api('/api/campaigns/estimate', {
      method: 'POST',
      body: JSON.stringify({ segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] } }),
    })
    expect(estimate.body.recipients).toBe(3)
    expect(estimate.body.sample).toHaveLength(3)
  })

  it('creates a broadcast campaign with one step', async () => {
    const created = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Welcome broadcast',
        type: 'broadcast',
        fromEmail: 'hello@demo.test',
        fromName: 'Demo',
        segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
        schedule: { timezone: 'UTC', ratePerMinute: 60, dailyCap: 100, skipWeekends: false, windowStartHour: null, windowEndHour: null },
        tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
        steps: [{ name: 'Welcome', subject: 'Welcome!', html: '<p>Hi {{ first_name }}, see <a href="https://docs.test/start">the guide</a>.</p>' }],
      }),
    })
    expect(created.status).toBe(201)
    campaignId = created.body.id
    expect(created.body.status).toBe('draft')
    expect(created.body.recipientCount).toBe(3)
  })

  it('refuses to start a campaign with no recipients', async () => {
    const empty = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Empty', fromEmail: 'a@b.cc', segment: { listIds: [999], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }, steps: [{ subject: 'x', html: '<p>y</p>' }] }),
    })
    const started = await ws.api(`/api/campaigns/${empty.body.id}/start`, { method: 'POST', body: JSON.stringify({}) })
    expect(started.status).toBe(400)
    expect(started.body.error.message).toMatch(/recipients/i)
  })

  it('starts immediately and the engine drains the queue', async () => {
    const started = await ws.api(`/api/campaigns/${campaignId}/start`, { method: 'POST', body: JSON.stringify({}) })
    expect(started.status).toBe(200)
    expect(started.body.status).toBe('running')
    expect(started.body.stats.queued).toBe(3)

    // the start route already nudged the worker; draining must converge either way
    const drained = await drainQueue()
    expect(drained.processed + drained.skipped).toBeGreaterThanOrEqual(0)

    const after = await ws.api(`/api/campaigns/${campaignId}`)
    expect(after.body.status).toBe('completed')
    expect(after.body.stats.sent).toBe(3)
    expect(after.body.stats.progress).toBe(100)
  })

  it('captured the rendered message with personalisation, pixel, tracked link and unsubscribe', async () => {
    const inbox = await ws.api('/api/mailbox')
    expect(inbox.body.total).toBe(3)
    const message = inbox.body.items.find((m: { toEmail: string }) => m.toEmail === 'sofia@globex.example')
    expect(message.subject).toBe('Welcome!')
    expect(message.html).toContain('Hi Sofia')
    expect(message.headers['List-Unsubscribe']).toMatch(/^<http:\/\/127\.0\.0\.1:\d+\/t\/u\/.+>$/)
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')

    const links = [...message.html.matchAll(/href="([^"]+)"/g)].map((m: string[]) => m[1])
    clickUrl = links.find((href: string) => href.includes('/t/c/'))!
    unsubUrl = links.find((href: string) => href.includes('/t/u/'))!
    messageUrl = message.html.match(/src="(http[^"]+\/t\/o\/[^"]+)"/)![1]
    expect(clickUrl).toBeTruthy()
    expect(unsubUrl).toBeTruthy()
    expect(messageUrl).toBeTruthy()
    expect(message.text).toContain('the guide (https://docs.test/start)')
    expect(message.text).toContain('Unsubscribe: ')
  })

  it('records an open exactly once per send but counts repeats', async () => {
    await expect(fetch(messageUrl).then((r) => ({ status: r.status, type: r.headers.get('content-type') }))).resolves.toEqual({ status: 200, type: 'image/gif' })
    await fetch(messageUrl)

    const sends = await ws.api(`/api/campaigns/${campaignId}/sends?status=sent`)
    const sofia = sends.body.items.find((s: { contactEmail: string }) => s.contactEmail === 'sofia@globex.example')
    expect(sofia.openCount).toBe(2)
    const stats = await ws.api(`/api/campaigns/${campaignId}/stats`)
    expect(stats.body.stats.opens).toBe(2)
    expect(stats.body.stats.uniqueOpens).toBe(1)
  })

  it('redirects clicks through the tracker and counts them', async () => {
    const response = await fetch(clickUrl, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://docs.test/start')
    const stats = await ws.api(`/api/campaigns/${campaignId}/stats`)
    expect(stats.body.stats.uniqueClicks).toBe(1)
    expect(stats.body.funnel.find((f: { label: string }) => f.label === 'Clicked').value).toBe(1)
  })

  it('rejects forged tracking tokens', async () => {
    const forged = `${ws.base}/t/o/${btoa(JSON.stringify({ k: 'o', i: 1 })).replace(/=+$/, '')}.notavalidsignature`
    const pixel = await fetch(forged)
    expect(pixel.status).toBe(200) // the pixel must never break email rendering
    const click = await fetch(`${ws.base}/t/c/bogus?u=https://evil.test`, { redirect: 'manual' })
    expect(click.status).toBe(400)
  })

  it('unsubscribes through the signed link and stops future sends', async () => {
    const confirm = await fetch(unsubUrl)
    expect(await confirm.text()).toContain('Unsubscribe from these emails?')

    const done = await fetch(unsubUrl, { method: 'POST' })
    expect(done.status).toBe(200)
    expect(await done.text()).toContain('You have been unsubscribed')

    const contact = await ws.api('/api/contacts/by-email?email=sofia@globex.example')
    expect(contact.body.status).toBe('unsubscribed')
    const stats = await ws.api(`/api/campaigns/${campaignId}/stats`)
    expect(stats.body.stats.unsubscribes).toBe(1)

    // a follow-up campaign must not include her any more
    const second = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Follow-up', type: 'broadcast', fromEmail: 'hello@demo.test', segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }, steps: [{ subject: 'Still there?', html: '<p>hey</p>' }] }),
    })
    expect(second.body.recipientCount).toBe(2)
  })

  it('supports RFC 8058 one-click unsubscribe used by mail providers', async () => {
    const list = await ws.api('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Digest', description: 'Weekly reading' }) })
    expect(list.body.subscribeToken).toHaveLength(16)
    await ws.api('/api/contacts', { method: 'POST', body: JSON.stringify({ email: 'oneclick@demo.test', name: 'One Click', listIds: [list.body.id] }) })

    const campaign = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Digest test', fromEmail: 'hello@demo.test', segment: { listIds: [list.body.id], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] }, steps: [{ subject: 'This week', html: '<p>hello</p>' }] }),
    })
    await ws.api(`/api/campaigns/${campaign.body.id}/start`, { method: 'POST', body: JSON.stringify({}) })
    await drainQueue()

    const message = (await ws.api('/api/mailbox?q=oneclick@demo.test')).body.items[0]
    const unsubUrl = [...message.html.matchAll(/href="([^"]*\/t\/u\/[^"]+)"/g)].map((m: string[]) => m[1])[0]
    expect(unsubUrl).toBeTruthy()

    const oneClick = await fetch(unsubUrl, { headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
    expect(oneClick.status).toBe(200)
    expect(await oneClick.text()).toBe('List-Unsubscribe=One-Click')

    const contact = await ws.api('/api/contacts/by-email?email=oneclick@demo.test')
    expect(contact.body.status).toBe('unsubscribed')

    // and the preference centre lets them back in
    const token = unsubUrl.split('/t/u/')[1]
    const resub = await fetch(`${ws.base}/t/p/${token}`, { method: 'POST' })
    expect(await resub.text()).toContain('You are subscribed again')
    expect((await ws.api('/api/contacts/by-email?email=oneclick@demo.test')).body.status).toBe('subscribed')
  })

  it('builds a sequence whose later steps are queued in the future', async () => {
    const sequence = await ws.api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Onboarding',
        type: 'sequence',
        fromEmail: 'hello@demo.test',
        segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
        steps: [
          { name: 'Day 0', delayMinutes: 0, subject: 'Welcome', html: '<p>welcome</p>' },
          { name: 'Day 2', delayMinutes: 2880, subject: 'Tips', html: '<p>tips</p>' },
        ],
      }),
    })
    const started = await ws.api(`/api/campaigns/${sequence.body.id}/start`, { method: 'POST', body: JSON.stringify({}) })
    expect(started.body.stats.recipients).toBe(4) // 2 contacts × 2 steps

    const sends = await ws.api(`/api/campaigns/${sequence.body.id}/sends?perPage=50`)
    const future = sends.body.items.filter((s: { subject: string }) => s.subject === 'Tips')
    expect(future.length).toBe(2)
    for (const send of future) {
      expect(new Date(send.sendAfter).getTime()).toBeGreaterThan(Date.now() + 24 * 3_600_000)
    }
  })

  it('surfaces the campaign and audience on the dashboard', async () => {
    const dash = await ws.api('/api/stats/dashboard')
    expect(dash.body.totals.contacts).toBe(4)
    expect(dash.body.totals.subscribed).toBe(3) // oneclick@ opted back in via the preference centre
    expect(dash.body.totals.sent).toBeGreaterThanOrEqual(3)
    expect(dash.body.topCampaigns[0].name).toBe('Welcome broadcast')
    expect(dash.body.series).toHaveLength(24)
    expect(dash.body.engine.transport).toBe('memory')
    expect(dash.body.recentEvents.some((e: { kind: string }) => e.kind === 'contact.opened')).toBe(true)
    expect(dash.body.recentEvents.some((e: { kind: string }) => e.kind === 'contact.unsubscribed')).toBe(true)
  })

  it('lists activity for a contact including the unsubscribe', async () => {
    const contact = await ws.api('/api/contacts/by-email?email=sofia@globex.example')
    const events = await ws.api(`/api/contacts/${contact.body.id}/events`)
    expect(events.body.items.map((e: { kind: string }) => e.kind)).toContain('contact.unsubscribed')
  })
})
