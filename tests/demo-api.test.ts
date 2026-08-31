import { beforeEach, describe, expect, it } from 'vitest'
import { handleDemoRequest } from '../src/client/lib/demo'
import { getStore, resetStore } from '../src/client/lib/demo/store'
import type {
  CampaignDto,
  ContactDto,
  DashboardDto,
  ImportResult,
  ListDto,
  MailboxMessageDto,
  Paged,
  StepDto,
  TagDto,
  TemplateDto,
  UserDto,
  WorkspaceSettings,
} from '../src/shared/types'

describe('demo in-browser API', () => {
  beforeEach(() => {
    resetStore()
  })

  it('handles bootstrap and auth lifecycle', async () => {
    const boot = await handleDemoRequest<{ user: UserDto | null; needsSetup: boolean; settings?: WorkspaceSettings }>('/api/bootstrap')
    expect(boot.user).not.toBeNull()
    expect(boot.user?.email).toBe('admin@maillocal.dev')
    expect(boot.needsSetup).toBe(false)
    expect(boot.settings?.workspaceName).toBe('Mail Automation')

    const me = await handleDemoRequest<{ user: UserDto | null; demoMode: boolean }>('/api/auth/me')
    expect(me.demoMode).toBe(true)
    expect(me.user?.email).toBe('admin@maillocal.dev')

    const logout = await handleDemoRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
    expect(logout.ok).toBe(true)

    const bootLoggedOut = await handleDemoRequest<{ user: UserDto | null; needsSetup: boolean }>('/api/bootstrap')
    expect(bootLoggedOut.user).toBeNull()

    const login = await handleDemoRequest<{ user: UserDto; csrfOk: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    })
    expect(login.user.email).toBe('owner@example.com')
  })

  it('manages lists, members and tokens', async () => {
    const initial = await handleDemoRequest<{ items: ListDto[]; totals: Record<string, number> }>('/api/lists')
    expect(initial.items.length).toBe(3)
    expect(initial.totals.contacts).toBeGreaterThan(0)

    const created = await handleDemoRequest<ListDto>('/api/lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta Testers', description: 'Early adopters' }),
    })
    expect(created.id).toBeGreaterThan(0)
    expect(created.name).toBe('Beta Testers')
    expect(created.subscribeToken).toHaveLength(12)

    // Cannot create duplicate list name
    await expect(
      handleDemoRequest('/api/lists', {
        method: 'POST',
        body: JSON.stringify({ name: 'Beta Testers' }),
      }),
    ).rejects.toThrow(/already exists/)

    const updated = await handleDemoRequest<ListDto>(`/api/lists/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updated description', archived: true }),
    })
    expect(updated.description).toBe('Updated description')
    expect(updated.archived).toBe(true)

    const unarchivedOnly = await handleDemoRequest<{ items: ListDto[] }>('/api/lists')
    expect(unarchivedOnly.items.some((l) => l.id === created.id)).toBe(false)

    const includeArchived = await handleDemoRequest<{ items: ListDto[] }>('/api/lists?includeArchived=1')
    expect(includeArchived.items.some((l) => l.id === created.id)).toBe(true)

    const regen = await handleDemoRequest<ListDto>(`/api/lists/${created.id}/regenerate-token`, { method: 'POST' })
    expect(regen.subscribeToken).not.toBe(created.subscribeToken)

    // Add and remove members
    const contacts = await handleDemoRequest<Paged<ContactDto>>('/api/contacts?perPage=5')
    const contactIds = contacts.items.map((c) => c.id)
    const addMembers = await handleDemoRequest<{ ok: boolean; added: number }>(`/api/lists/${created.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ contactIds }),
    })
    expect(addMembers.added).toBe(contactIds.length)

    const listContacts = await handleDemoRequest<Paged<ContactDto>>(`/api/lists/${created.id}/contacts?status=all`)
    expect(listContacts.items.length).toBe(contactIds.length)

    const removeMember = await handleDemoRequest<{ ok: boolean }>(`/api/lists/${created.id}/members/${contactIds[0]}`, {
      method: 'DELETE',
    })
    expect(removeMember.ok).toBe(true)

    // Delete list
    const deleted = await handleDemoRequest<{ ok: boolean }>(`/api/lists/${created.id}`, { method: 'DELETE' })
    expect(deleted.ok).toBe(true)
  })

  it('manages tags', async () => {
    const list = await handleDemoRequest<{ items: TagDto[] }>('/api/tags')
    expect(list.items.length).toBeGreaterThanOrEqual(6)

    const created = await handleDemoRequest<TagDto>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name: 'priority-client', color: '#ff0000' }),
    })
    expect(created.name).toBe('priority-client')
    expect(created.color).toBe('#ff0000')

    const del = await handleDemoRequest<{ ok: boolean }>(`/api/tags/${created.id}`, { method: 'DELETE' })
    expect(del.ok).toBe(true)
  })

  it('manages contacts, import and export', async () => {
    const fields = await handleDemoRequest<{ items: string[] }>('/api/contacts/fields')
    expect(fields.items).toContain('company')
    expect(fields.items).toContain('plan')

    const created = await handleDemoRequest<ContactDto>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({
        email: 'alice.wonderland@acme.example',
        name: 'Alice Wonderland',
        fields: { role: 'Engineer', location: 'London' },
        listIds: [1],
        tags: ['trial', 'new-tag'],
      }),
    })
    expect(created.email).toBe('alice.wonderland@acme.example')
    expect(created.name).toBe('Alice Wonderland')
    expect(created.lists.some((l) => l.id === 1)).toBe(true)
    expect(created.tags.some((t) => t.name === 'trial')).toBe(true)

    // Filter by status=all returns all statuses
    const all = await handleDemoRequest<Paged<ContactDto>>('/api/contacts?status=all&perPage=100')
    expect(all.items.some((c) => c.status === 'unsubscribed')).toBe(true)
    expect(all.items.some((c) => c.status === 'subscribed')).toBe(true)

    // Filter by specific status
    const unsubscribed = await handleDemoRequest<Paged<ContactDto>>('/api/contacts?status=unsubscribed')
    expect(unsubscribed.items.every((c) => c.status === 'unsubscribed')).toBe(true)

    // Unsubscribe / resubscribe contact
    const unsub = await handleDemoRequest<ContactDto>(`/api/contacts/${created.id}/unsubscribe`, { method: 'POST' })
    expect(unsub.status).toBe('unsubscribed')
    expect(unsub.unsubscribedAt).not.toBeNull()

    const resub = await handleDemoRequest<ContactDto>(`/api/contacts/${created.id}/resubscribe`, { method: 'POST' })
    expect(resub.status).toBe('subscribed')
    expect(resub.unsubscribedAt).toBeNull()

    // CSV import
    const csvData = `email,name,company,tags
bob.builder@acme.example,Bob Builder,Acme,trial;builder
charlie.brown@acme.example,Charlie Brown,Acme,customer`

    const importRes = await handleDemoRequest<ImportResult>('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ csv: csvData, listId: 1, duplicatePolicy: 'update', tags: ['imported'] }),
    })
    expect(importRes.created).toBe(2)
    expect(importRes.skipped).toEqual([])

    // CSV export
    const exportCsv = await handleDemoRequest<string>('/api/contacts/export')
    expect(typeof exportCsv).toBe('string')
    expect(exportCsv).toContain('alice.wonderland@acme.example')
    expect(exportCsv).toContain('bob.builder@acme.example')

    // Bulk delete
    const bulk = await handleDemoRequest<{ ok: boolean; deleted: number }>('/api/contacts/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [created.id] }),
    })
    expect(bulk.deleted).toBe(1)
  })

  it('manages templates and live preview', async () => {
    const list = await handleDemoRequest<Paged<TemplateDto>>('/api/templates')
    expect(list.items.length).toBe(6)

    const preview = await handleDemoRequest<{
      subject: string
      preheader: string
      html: string
      text: string
      issues: string[]
    }>('/api/templates/preview', {
      method: 'POST',
      body: JSON.stringify({
        subject: 'Hello {{ first_name | friend }}, welcome to {{ company }}',
        preheader: 'Quick check',
        html: '<p>Hi {{ first_name }}, your plan is {{ plan }}. Unknown: {{ invalid_var }}</p>',
        text: '',
        sample: { first_name: 'David', company: 'Globex', plan: 'Enterprise' },
      }),
    })
    expect(preview.subject).toBe('Hello David, welcome to Globex')
    expect(preview.html).toContain('Hi David, your plan is Enterprise.')
    expect(preview.issues).toContain('invalid_var')

    const created = await handleDemoRequest<TemplateDto>('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Custom Promotional Template',
        subject: 'Special Offer {{ first_name }}',
        html: '<p>Discount for {{ company }}</p>',
      }),
    })
    expect(created.name).toBe('Custom Promotional Template')

    const dup = await handleDemoRequest<TemplateDto>(`/api/templates/${created.id}/duplicate`, { method: 'POST' })
    expect(dup.name).toBe('Custom Promotional Template copy')

    const testSend = await handleDemoRequest<{ ok: boolean; transport: string; mailboxId: number }>(
      `/api/templates/${created.id}/test`,
      {
        method: 'POST',
        body: JSON.stringify({ email: 'test.preview@example.com' }),
      },
    )
    expect(testSend.ok).toBe(true)
    expect(testSend.transport).toBe('memory')

    const deleted = await handleDemoRequest<{ ok: boolean }>(`/api/templates/${created.id}`, { method: 'DELETE' })
    expect(deleted.ok).toBe(true)
  })

  it('handles campaign lifecycle and audience estimation', async () => {
    // Audience estimate
    const estimate = await handleDemoRequest<{ recipients: number; sample: { id: number; email: string }[] }>(
      '/api/campaigns/estimate',
      {
        method: 'POST',
        body: JSON.stringify({ segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] } }),
      },
    )
    expect(estimate.recipients).toBeGreaterThan(0)
    expect(estimate.sample.length).toBeGreaterThan(0)

    // Create campaign
    const campaign = await handleDemoRequest<CampaignDto>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Fall Product Launch',
        type: 'broadcast',
        segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
        steps: [
          {
            name: 'Step 1: Announcement',
            subject: 'Introducing our newest feature, {{ first_name }}',
            html: '<p>Check out our update at {{ company }}</p>',
            delayMinutes: 0,
          },
        ],
      }),
    })
    expect(campaign.name).toBe('Fall Product Launch')
    expect(campaign.status).toBe('draft')

    // Add another step
    const step2 = await handleDemoRequest<StepDto>(`/api/campaigns/${campaign.id}/steps`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Step 2: Follow-up',
        subject: 'Did you see the announcement?',
        html: '<p>Follow up note</p>',
        delayMinutes: 1440,
        skipIfOpened: true,
      }),
    })
    expect(step2.name).toBe('Step 2: Follow-up')
    expect(step2.position).toBe(1)

    // Validate
    const validation = await handleDemoRequest<{ ready: boolean; problems: string[] }>(`/api/campaigns/${campaign.id}/validate`, {
      method: 'POST',
    })
    expect(validation.ready).toBe(true)
    expect(validation.problems).toHaveLength(0)

    // Start campaign
    const started = await handleDemoRequest<CampaignDto>(`/api/campaigns/${campaign.id}/start`, { method: 'POST' })
    expect(started.status).toBe('running')
    expect(started.stats.queued + started.stats.sent).toBeGreaterThan(0)

    // Pause & Resume
    const paused = await handleDemoRequest<CampaignDto>(`/api/campaigns/${campaign.id}/pause`, { method: 'POST' })
    expect(paused.status).toBe('paused')

    const resumed = await handleDemoRequest<CampaignDto>(`/api/campaigns/${campaign.id}/resume`, { method: 'POST' })
    expect(resumed.status).toBe('running')

    // Stats & series
    const stats = await handleDemoRequest<{ stats: { recipients: number }; funnel: { label: string }[] }>(`/api/campaigns/${campaign.id}/stats`)
    expect(stats.stats.recipients).toBeGreaterThan(0)
    expect(stats.funnel.length).toBe(4)

    const series = await handleDemoRequest<{ points: { hour: string }[] }>(`/api/campaigns/${campaign.id}/series?hours=24`)
    expect(series.points.length).toBe(24)

    // Cancel
    const canceled = await handleDemoRequest<CampaignDto>(`/api/campaigns/${campaign.id}/cancel`, { method: 'POST' })
    expect(canceled.status).toBe('canceled')
  })

  it('runs the simulated sending engine (tick & drain)', async () => {
    // Create and start a campaign with delay 0
    const campaign = await handleDemoRequest<CampaignDto>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Instant Broadcast',
        type: 'broadcast',
        segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
        steps: [
          {
            name: 'Email 1',
            subject: 'Instant test email to {{ first_name }}',
            html: '<p>Hello world</p>',
            delayMinutes: 0,
          },
        ],
      }),
    })

    await handleDemoRequest(`/api/campaigns/${campaign.id}/start`, { method: 'POST' })

    // Drain engine
    const drainResult = await handleDemoRequest<{ processed: number; sent: number; skipped: number }>('/api/engine/drain', {
      method: 'POST',
      body: JSON.stringify({ maxRounds: 10 }),
    })
    expect(drainResult.processed).toBeGreaterThan(0)
    expect(drainResult.sent).toBeGreaterThan(0)

    // Mailbox should now have messages
    const mailbox = await handleDemoRequest<Paged<MailboxMessageDto>>('/api/mailbox')
    expect(mailbox.items.length).toBeGreaterThan(0)

    // Simulate open on a message
    const firstMsg = mailbox.items[0]!
    const simOpen = await handleDemoRequest<{ ok: boolean; message: MailboxMessageDto; stats: unknown }>(
      `/api/mailbox/${firstMsg.id}/simulate-open`,
      { method: 'POST' },
    )
    expect(simOpen.ok).toBe(true)
    expect(simOpen.message.simulatedOpenAt).not.toBeNull()
  })

  it('provides dashboard metrics, activity and settings', async () => {
    const dash = await handleDemoRequest<DashboardDto>('/api/stats/dashboard')
    expect(dash.totals.contacts).toBeGreaterThan(0)
    expect(dash.totals.sent).toBeGreaterThan(0)
    expect(dash.topCampaigns.length).toBeGreaterThan(0)
    expect(dash.series.length).toBe(24)

    const growth = await handleDemoRequest<{ points: { day: string }[] }>('/api/stats/growth?days=14')
    expect(growth.points.length).toBe(14)

    const activity = await handleDemoRequest<{ items: unknown[] }>('/api/activity?limit=10')
    expect(activity.items.length).toBeGreaterThan(0)

    const settings = await handleDemoRequest<WorkspaceSettings>('/api/settings')
    expect(settings.workspaceName).toBe('Mail Automation')

    const updatedSettings = await handleDemoRequest<WorkspaceSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ workspaceName: 'Brand New Automation' }),
    })
    expect(updatedSettings.workspaceName).toBe('Brand New Automation')

    const smtpTest = await handleDemoRequest<{ ok: boolean; transport: string }>('/api/settings/smtp/test', {
      method: 'POST',
    })
    expect(smtpTest.ok).toBe(true)
    expect(smtpTest.transport).toBe('memory')
  })

  it('returns copies from handlers, not live store references', async () => {
    const list = await handleDemoRequest<ListDto>('/api/lists/1')
    list.name = 'MUTATED DIRECTLY'

    const fresh = await handleDemoRequest<ListDto>('/api/lists/1')
    expect(fresh.name).not.toBe('MUTATED DIRECTLY')

    const contact = await handleDemoRequest<ContactDto>('/api/contacts/1')
    contact.name = 'MUTATED CONTACT'

    const freshContact = await handleDemoRequest<ContactDto>('/api/contacts/1')
    expect(freshContact.name).not.toBe('MUTATED CONTACT')
  })
})
