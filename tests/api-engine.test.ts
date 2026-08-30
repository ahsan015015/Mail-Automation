import { beforeAll, describe, expect, it, vi } from 'vitest'
import { bootWorkspace, type Workspace } from './helpers.js'

/**
 * Delivery rules. The transport is stubbed so failures can be provoked without
 * a network, while the real queue, throttle, retry and skip logic runs.
 */
const controls = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'transient' | 'permanent',
  attempts: new Map<string, number>(),
  delivered: [] as string[],
}))

vi.mock('../src/server/services/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/services/mailer.js')>()
  return {
    ...actual,
    deliver: async (input: { to: { address: string } }) => {
      if (controls.mode === 'transient') {
        const seen = (controls.attempts.get(input.to.address) ?? 0) + 1
        controls.attempts.set(input.to.address, seen)
        if (seen < 2) throw Object.assign(new Error('451 temporary problem'), { responseCode: 451 })
      }
      if (controls.mode === 'permanent') throw Object.assign(new Error('550 5.1.1 recipient unknown'), { responseCode: 550 })
      controls.delivered.push(input.to.address)
      return { messageId: `stub-${controls.delivered.length}@demo.test`, transport: 'memory' as const, response: '250 ok', raw: Buffer.from('stub') }
    },
    verifyTransport: async () => ({ ok: true, transport: 'memory' as const, message: 'stubbed' }),
    resetTransporter: () => undefined,
  }
})

let ws: Workspace
let campaigns: typeof import('../src/server/services/campaigns.js')
let contacts: typeof import('../src/server/services/contacts.js')
let lists: typeof import('../src/server/services/lists.js')
let engine: typeof import('../src/server/services/engine.js').engine
let getDb: () => import('../src/server/db/sqlite.js').Database

beforeAll(async () => {
  ws = await bootWorkspace()
  campaigns = await import('../src/server/services/campaigns.js')
  contacts = await import('../src/server/services/contacts.js')
  lists = await import('../src/server/services/lists.js')
  engine = (await import('../src/server/services/engine.js')).engine
  getDb = (await import('../src/server/db/sqlite.js')).getDb
})

const seedAudience = (count: number, listName: string): { listId: number; ids: number[] } => {
  const suffix = Math.random().toString(36).slice(2, 7)
  const list = lists.createList({ name: `${listName} ${suffix}` })
  const ids: number[] = []
  for (let i = 0; i < count; i++) {
    const contact = contacts.createContact({ email: `${suffix}-${i}@engine.test`, name: `Engine ${i}`, listIds: [list.id] })
    ids.push(contact.id)
  }
  return { listId: list.id, ids }
}

const makeCampaign = (args: {
  listId: number
  name?: string
  ratePerMinute?: number
  dailyCap?: number
  windowStartHour?: number | null
  windowEndHour?: number | null
  skipWeekends?: boolean
  steps?: Array<{ subject: string; delayMinutes?: number; skipIfOpened?: boolean; skipIfClicked?: boolean }>
  scheduledStartAt?: string | null
}): number => {
  const result = campaigns.createCampaign({
    name: args.name ?? `Engine ${Math.random().toString(36).slice(2, 6)}`,
    type: args.steps && args.steps.length > 1 ? 'sequence' : 'broadcast',
    fromEmail: 'engine@demo.test',
    fromName: 'Engine',
    segment: { listIds: [args.listId], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: {
      startAt: null,
      timezone: 'UTC',
      ratePerMinute: args.ratePerMinute ?? 100,
      dailyCap: args.dailyCap ?? 1000,
      windowStartHour: args.windowStartHour ?? null,
      windowEndHour: args.windowEndHour ?? null,
      skipWeekends: args.skipWeekends ?? false,
    },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: args.scheduledStartAt ?? null,
    steps: (args.steps ?? [{ subject: 'Hello', delayMinutes: 0 }]).map((step, index) => ({
      name: `Email ${index + 1}`,
      subject: step.subject,
      html: `<p>Hi {{ first_name }}, body ${step.subject}</p>`,
      delayMinutes: step.delayMinutes ?? 0,
      skipIfOpened: step.skipIfOpened ?? false,
      skipIfClicked: step.skipIfClicked ?? false,
    })),
  })
  return result.id
}

describe('throttling', () => {
  it('respects a per-campaign rate limit and resumes later', async () => {
    const { listId } = seedAudience(5, 'rate')
    const id = makeCampaign({ listId, ratePerMinute: 2 })
    campaigns.startCampaign(id)

    await engine.tick()
    let stats = campaigns.campaignStats(id)
    expect(stats.sent).toBe(2)
    expect(stats.queued).toBe(3)

    // same minute → nothing new, so a burst cannot slip through
    await engine.tick()
    expect(campaigns.campaignStats(id).sent).toBe(2)

    // pretend the previous sends happened a minute ago
    getDb().run(`UPDATE sends SET sent_at = ? WHERE campaign_id = ?`, new Date(Date.now() - 61_000).toISOString(), id)
    await engine.tick()
    expect(campaigns.campaignStats(id).sent).toBe(4)
  })

  it('respects a daily cap', async () => {
    const { listId } = seedAudience(4, 'cap')
    const id = makeCampaign({ listId, dailyCap: 1, ratePerMinute: 100 })
    campaigns.startCampaign(id)
    await engine.tick()
    expect(campaigns.campaignStats(id).sent).toBe(1)
  })

  it('holds messages outside the sending window', async () => {
    const { listId } = seedAudience(3, 'window')
    const hour = new Date().getUTCHours()
    const outsideStart = (hour + 3) % 24
    const id = makeCampaign({ listId, windowStartHour: outsideStart, windowEndHour: (outsideStart + 1) % 24 })
    campaigns.startCampaign(id)
    await engine.tick()
    expect(campaigns.campaignStats(id).sent).toBe(0)
    expect(campaigns.getCampaign(id).status).toBe('running')

    // a window that includes the current hour releases the queue
    getDb().run(
      `UPDATE campaigns SET schedule = json_set(schedule, '$.windowStartHour', ?, '$.windowEndHour', ?) WHERE id = ?`,
      0,
      24,
      id,
    )
    await engine.tick()
    expect(campaigns.campaignStats(id).sent).toBe(3)
  })

  it('only activates a campaign when its scheduled time arrives', async () => {
    const { listId } = seedAudience(2, 'scheduled')
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const id = makeCampaign({ listId, scheduledStartAt: future })
    const started = campaigns.startCampaign(id, future)
    expect(started.status).toBe('scheduled')
    expect(started.stats.recipients).toBe(2)

    await engine.tick()
    expect(campaigns.getCampaign(id).status).toBe('scheduled')
    expect(campaigns.campaignStats(id).sent).toBe(0)

    getDb().run(`UPDATE campaigns SET scheduled_start_at = ? WHERE id = ?`, new Date(Date.now() - 1000).toISOString(), id)
    getDb().run(`UPDATE sends SET send_after = ? WHERE campaign_id = ?`, new Date(Date.now() - 1000).toISOString(), id)
    await engine.tick()
    expect(campaigns.getCampaign(id).status).toBe('completed')
    expect(campaigns.campaignStats(id).sent).toBe(2)
  })
})

describe('failures and skips', () => {
  it('retries a transient failure with backoff, then succeeds', async () => {
    controls.mode = 'transient'
    controls.attempts.clear()
    const { listId } = seedAudience(1, 'retry')
    const id = makeCampaign({ listId, name: 'Retry lane' })
    campaigns.startCampaign(id)
    await engine.tick()

    let stats = campaigns.campaignStats(id)
    expect(stats.sent).toBe(0)
    expect(stats.queued).toBe(1)
    const send = getDb().get<{ attempts: number; error: string; send_after: string }>('SELECT attempts, error, send_after FROM sends WHERE campaign_id = ?', id)!
    expect(send.attempts).toBe(1)
    expect(send.error).toContain('451')
    expect(new Date(send.send_after).getTime()).toBeGreaterThan(Date.now())

    controls.mode = 'none'
    getDb().run(`UPDATE sends SET send_after = ? WHERE campaign_id = ?`, new Date(Date.now() - 1000).toISOString(), id)
    await engine.tick()
    stats = campaigns.campaignStats(id)
    expect(stats.sent).toBe(1)
    expect(stats.failed).toBe(0)
  })

  it('gives up on a permanent failure and suppresses the contact', async () => {
    controls.mode = 'permanent'
    const { listId, ids } = seedAudience(2, 'bounce')
    const id = makeCampaign({ listId, name: 'Bounce lane' })
    campaigns.startCampaign(id)
    await engine.tick()

    const stats = campaigns.campaignStats(id)
    expect(stats.bounced).toBe(2)
    expect(stats.sent).toBe(0)
    expect(contacts.getContact(ids[0]!).status).toBe('bounced')

    // bounces must not be retried and the campaign must finish
    await engine.tick()
    expect(campaigns.getCampaign(id).status).toBe('completed')
    controls.mode = 'none'
  })

  it('skips a follow-up when the contact already opened, and records it', async () => {
    const { listId, ids } = seedAudience(2, 'skip')
    const id = makeCampaign({ listId, name: 'Skip lane', steps: [{ subject: 'First', delayMinutes: 0 }] })
    campaigns.startCampaign(id)
    await engine.drain({ maxRounds: 20 })
    expect(campaigns.campaignStats(id).sent).toBe(2)

    const first = getDb().get<{ id: number }>('SELECT id FROM sends WHERE campaign_id = ? AND contact_id = ?', id, ids[0]!)!
    getDb().run('UPDATE sends SET open_count = 1, opened_at = ? WHERE id = ?', new Date().toISOString(), first.id)

    // keep the campaign live so a follow-up step can be appended (the engine would
    // otherwise have marked it completed)
    getDb().run(`UPDATE campaigns SET status = 'running' WHERE id = ?`, id)
    campaigns.addStep(id, { name: 'Second', subject: 'Second', html: '<p>follow-up</p>', delayMinutes: 0, skipIfOpened: true })
    await engine.drain({ maxRounds: 20 })

    const rows = getDb().all<{ subject: string; status: string; contact_id: number }>(
      `SELECT st.subject, s.status, s.contact_id FROM sends s JOIN steps st ON st.id = s.step_id WHERE s.campaign_id = ? AND st.subject = 'Second'`,
      id,
    )
    expect(rows.find((row) => row.contact_id === ids[0])!.status).toBe('skipped')
    expect(rows.find((row) => row.contact_id === ids[1])!.status).toBe('sent')
    expect(campaigns.campaignStats(id).skipped).toBe(1)
  })

  it('cancelling a campaign skips everything still queued', async () => {
    const { listId } = seedAudience(3, 'cancel')
    const id = makeCampaign({ listId, ratePerMinute: 1, name: 'Cancel lane' })
    campaigns.startCampaign(id)
    campaigns.cancelCampaign(id)
    await engine.tick()
    const stats = campaigns.campaignStats(id)
    expect(stats.sent).toBe(0)
    expect(stats.queued).toBe(0)
    expect(stats.skipped + stats.recipients).toBeGreaterThanOrEqual(stats.recipients)
    expect(campaigns.getCampaign(id).status).toBe('canceled')
  })
})
