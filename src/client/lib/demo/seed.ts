import type {
  CampaignDto,
  CampaignSchedule,
  CampaignStats,
  ContactDto,
  EventDto,
  ListDto,
  MailboxMessageDto,
  SendDto,
  TagDto,
  TemplateDto,
  UserDto,
  WorkspaceSettings,
} from '@shared/types'
import { render } from '../../../server/lib/merge'
import { sanitizeEmailHtml, htmlToText } from '../../../server/lib/html'
import type { DemoStore } from './store'

const FIRST = [
  'Ahsan', 'Mira', 'Daniel', 'Sofia', 'Yuki', 'Noah', 'Lena', 'Omar', 'Priya', 'Jonas',
  'Amara', 'Ivan', 'Chen', 'Fatima', 'Lucas', 'Nora', 'Tariq', 'Elif', 'Marco', 'Zara',
  'Kwame', 'Ines', 'Ravi', 'Hana', 'Felix', 'Aisha', 'Bruno', 'Sara', 'Kenji', 'Nadia',
]
const LAST = [
  'Rahman', 'Kowalski', 'Okafor', 'Rossi', 'Tanaka', 'Bennett', 'Fischer', 'Haddad', 'Nair', 'Lindqvist',
  'Diallo', 'Petrov', 'Wei', 'Ahmadi', 'Silva', 'Holm', 'Aziz', 'Yilmaz', 'Bianchi', 'Ali',
  'Mensah', 'Costa', 'Iyer', 'Sato', 'Baumann', 'Farouk', 'Almeida', 'Novak', 'Mori', 'Hussein',
]
const COMPANIES = ['Northwind', 'Globex', 'Initech', 'Umbrella Labs', 'Hooli', 'Vandelay', 'Acme Robotics', 'Lumen', 'Bluepeak', 'Orbital']
const PLANS = ['Free', 'Starter', 'Pro', 'Scale']

const TEMPLATES: { name: string; subject: string; preheader: string; html: string }[] = [
  {
    name: 'Welcome · day 0',
    subject: 'Welcome aboard, {{ first_name | friend }} — here is your 3-step start',
    preheader: 'Set up your first automation in under ten minutes.',
    html: `<h2 style="margin:0 0 10px;font-size:20px">Hi {{ first_name | there }},</h2>
<p>You signed up for <strong>{{ company | Mail Automation }}</strong> on {{ date }}. Here is the fastest path to your first automated email:</p>
<ol style="padding-left:20px;line-height:1.8">
  <li>Add your subscriber list (CSV import takes a minute)</li>
  <li>Pick a template and write your first sequence</li>
  <li>Hit <em>Start</em> — we handle throttling, bounces and unsubscribes</li>
</ol>
<p><a href="https://example.com/docs/quickstart" style="background:#4f46e5;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Read the quickstart</a></p>
<p style="color:#475569;font-size:14px">Reply to this email and a human will answer. — the {{ campaign }} team</p>`,
  },
  {
    name: 'Trial ending · 3 days',
    subject: '{{ first_name | hi }}, your {{ plan | Pro }} trial ends Friday',
    preheader: 'Keep your automations running — it takes one click.',
    html: `<h2 style="margin:0 0 10px;font-size:19px">Your trial is almost up</h2>
<p>You have run <strong>4 automations</strong> and delivered 2,318 emails this month. On Friday the {{ plan | Pro }} workspace becomes read-only.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 16px;font-size:14px;color:#065f46">
Keeping your plan costs <strong>$29/mo</strong> — cancel any time.
</td></tr></table>
<p style="margin-top:18px"><a href="https://example.com/billing" style="background:#0f172a;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Keep my plan</a></p>`,
  },
  {
    name: 'Feature drop · scheduling',
    subject: 'New: send-window throttling and drip conditions',
    preheader: 'Two things people asked for, shipped this week.',
    html: `<h2 style="margin:0 0 12px;font-size:19px">Two new switches in Settings</h2>
<p><strong>Send windows.</strong> Keep campaigns inside 09:00–18:00 in each recipient's timezone. Boring, but it lifts open rates.</p>
<p><strong>Drip conditions.</strong> Skip a follow-up when the contact already opened or clicked the previous one.</p>
<p><a href="https://example.com/changelog">Read the changelog →</a></p>`,
  },
  {
    name: 'Webinar invite',
    subject: 'Live walkthrough Thursday 15:00 UTC (with Q&A)',
    preheader: '45 minutes, real automations, no slides.',
    html: `<h2 style="margin:0 0 10px;font-size:19px">Join the live build</h2>
<p>We will wire a real onboarding sequence from an empty list to a scheduled drip, then answer questions.</p>
<ul style="padding-left:20px;line-height:1.8">
  <li>Thursday, 15:00 UTC — 45 minutes</li>
  <li>Bring your CSV, leave with a running campaign</li>
</ul>
<p><a href="https://example.com/webinar" style="background:#4f46e5;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Reserve a seat</a></p>`,
  },
  {
    name: 'Win-back · 30 days quiet',
    subject: 'Is {{ company | your team }} still reading?',
    preheader: 'A short note, and an easy way to pause.',
    html: `<h2 style="margin:0 0 10px;font-size:19px">Quick check-in</h2>
<p>It has been a month since you opened anything from us. If the timing was wrong, no hard feelings — tell us and we will change it.</p>
<p><a href="https://example.com/preferences">Change email frequency</a> · <a href="https://example.com/reply">Reply and tell us what you need</a></p>`,
  },
  {
    name: 'Re-engagement · 3 days later',
    subject: 'One thing you missed, {{ first_name | friend }}',
    preheader: 'The 4-minute version of our most-opened guide.',
    html: `<h2 style="margin:0 0 10px;font-size:19px">The 4-minute version</h2>
<p>Most teams overthink sequences. Three emails, two days apart, one link each — that is the whole playbook.</p>
<p><a href="https://example.com/guide">Read the guide →</a></p>`,
  },
]

const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

export function createSeedStore(): DemoStore {
  const random = seededRandom(20260830)
  const now = new Date()
  const nowIso = now.toISOString()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const nineDaysAgo = new Date(now.getTime() - 9 * 86_400_000).getTime()

  const user: UserDto = {
    id: 1,
    email: 'admin@maillocal.dev',
    name: 'Demo Admin',
    role: 'owner',
    createdAt: thirtyDaysAgo,
  }

  const settings: WorkspaceSettings = {
    workspaceName: 'Mail Automation',
    fromName: 'Mail Automation',
    fromEmail: 'noreply@example.com',
    replyTo: '',
    transport: 'memory',
    smtp: {
      host: '',
      port: 587,
      secure: false,
      user: '',
      hasPassword: false,
      pool: 4,
      maxMessages: 50,
    },
    sending: {
      ratePerMinute: 30,
      dailyCap: 2000,
      maxAttempts: 4,
      backoffBaseSeconds: 30,
      windowStartHour: null,
      windowEndHour: null,
      timezone: 'UTC',
    },
    tracking: {
      openTracking: true,
      clickTracking: true,
      includeUnsubscribe: true,
      trackDomain: '',
    },
  }

  const lists: ListDto[] = [
    {
      id: 1,
      name: 'Trial users',
      description: 'Signed up in the last 30 days, no plan yet.',
      archived: false,
      contactCount: 0,
      subscribedCount: 0,
      unsubscribeCount: 0,
      subscribeToken: 'sub_trial001',
      createdAt: thirtyDaysAgo,
    },
    {
      id: 2,
      name: 'Customers',
      description: 'Paying workspaces — billing, product updates.',
      archived: false,
      contactCount: 0,
      subscribedCount: 0,
      unsubscribeCount: 0,
      subscribeToken: 'sub_cust002',
      createdAt: thirtyDaysAgo,
    },
    {
      id: 3,
      name: 'Newsletter',
      description: 'Monthly digest subscribers who opted in.',
      archived: false,
      contactCount: 0,
      subscribedCount: 0,
      unsubscribeCount: 0,
      subscribeToken: 'sub_news003',
      createdAt: thirtyDaysAgo,
    },
  ]

  const tags: TagDto[] = [
    { id: 1, name: 'trial', color: '#6366f1', contactCount: 0 },
    { id: 2, name: 'customer', color: '#0ea5e9', contactCount: 0 },
    { id: 3, name: 'newsletter', color: '#10b981', contactCount: 0 },
    { id: 4, name: 'vip', color: '#f59e0b', contactCount: 0 },
    { id: 5, name: 'webinar', color: '#ef4444', contactCount: 0 },
    { id: 6, name: 'cold', color: '#8b5cf6', contactCount: 0 },
  ]

  const templates: TemplateDto[] = TEMPLATES.map((tmpl, index) => {
    const html = sanitizeEmailHtml(tmpl.html)
    return {
      id: index + 1,
      name: tmpl.name,
      subject: tmpl.subject,
      preheader: tmpl.preheader,
      html,
      text: htmlToText(html),
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
    }
  })

  // Create contacts
  const contacts: ContactDto[] = []
  let nextContactId = 1

  FIRST.forEach((first, index) => {
    const last = LAST[index % LAST.length]!
    const company = COMPANIES[index % COMPANIES.length]!
    const plan = PLANS[index % PLANS.length]!
    const tagIndex = index % 3
    const tag = tags[tagIndex]!
    const listIndex = index % 3
    const list = lists[listIndex]!
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/[^a-z]/g, '')}.example`

    const createdAt = new Date(nineDaysAgo - (30 - index) * 3_600_000 * 4).toISOString()

    contacts.push({
      id: nextContactId++,
      email,
      name: `${first} ${last}`,
      fields: { company, plan },
      status: 'subscribed',
      tags: [{ id: tag.id, name: tag.name, color: tag.color, contactCount: 0 }],
      lists: [{ id: list.id, name: list.name }],
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      lastOpenAt: null,
      lastClickAt: null,
      unsubscribedAt: null,
      createdAt,
      updatedAt: createdAt,
    })
  })

  // Hand-written records matching the server seed
  const vipTag = tags.find((t) => t.name === 'vip')!
  const customerList = lists.find((l) => l.name === 'Customers')!
  const newsletterList = lists.find((l) => l.name === 'Newsletter')!

  contacts.push({
    id: nextContactId++,
    email: 'sam.diallo@hooli.example',
    name: 'Sam Diallo',
    fields: { plan: 'Scale', company: 'Hooli' },
    status: 'subscribed',
    tags: [{ id: vipTag.id, name: vipTag.name, color: vipTag.color, contactCount: 0 }],
    lists: [{ id: customerList.id, name: customerList.name }],
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    lastOpenAt: null,
    lastClickAt: null,
    unsubscribedAt: null,
    createdAt: thirtyDaysAgo,
    updatedAt: thirtyDaysAgo,
  })

  contacts.push({
    id: nextContactId++,
    email: 'unsubscribe.me@example.com',
    name: 'Riley Optout',
    fields: {},
    status: 'unsubscribed',
    tags: [],
    lists: [{ id: newsletterList.id, name: newsletterList.name }],
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    lastOpenAt: null,
    lastClickAt: null,
    unsubscribedAt: thirtyDaysAgo,
    createdAt: thirtyDaysAgo,
    updatedAt: thirtyDaysAgo,
  })

  contacts.push({
    id: nextContactId++,
    email: 'does-not-exist@acme-robotics.example',
    name: 'Deleted Mailbox',
    fields: { company: 'Acme Robotics' },
    status: 'subscribed',
    tags: [],
    lists: [{ id: customerList.id, name: customerList.name }],
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    lastOpenAt: null,
    lastClickAt: null,
    unsubscribedAt: null,
    createdAt: thirtyDaysAgo,
    updatedAt: thirtyDaysAgo,
  })

  // Setup campaigns
  const campaigns: CampaignDto[] = []
  const sends: SendDto[] = []
  const events: EventDto[] = []
  const mailbox: MailboxMessageDto[] = []
  let nextSendId = 1
  let nextEventId = 1
  let nextMailboxId = 1

  /* ── Campaign 1: March product announcement (completed broadcast) ────────── */
  const c1Template = templates[2]! // Feature drop · scheduling
  const c1Recipients = contacts.filter((c) => c.status === 'subscribed' && c.lists.some((l) => l.id === 2 || l.id === 3))

  const c1CreatedAt = new Date(nineDaysAgo - 3_600_000).toISOString()
  const c1StartedAt = new Date(nineDaysAgo).toISOString()
  const c1CompletedAt = new Date(nineDaysAgo + (c1Recipients.length + 2) * 90_000 + 60_000).toISOString()

  const c1Schedule: CampaignSchedule = {
    startAt: null,
    timezone: 'UTC',
    windowStartHour: null,
    windowEndHour: null,
    ratePerMinute: 60,
    dailyCap: 5000,
    skipWeekends: false,
  }

  events.push({
    id: nextEventId++,
    kind: 'campaign.created',
    campaignId: 1,
    campaignName: 'March product announcement',
    contactId: null,
    contactEmail: null,
    sendId: null,
    message: 'Draft “March product announcement” created',
    meta: { campaignName: 'March product announcement' },
    createdAt: c1CreatedAt,
  })

  events.push({
    id: nextEventId++,
    kind: 'campaign.started',
    campaignId: 1,
    campaignName: 'March product announcement',
    contactId: null,
    contactEmail: null,
    sendId: null,
    message: `Started — ${c1Recipients.length + 1} message(s) queued`,
    meta: { queued: c1Recipients.length + 1, scheduled: false, campaignName: 'March product announcement' },
    createdAt: c1StartedAt,
  })

  let c1Opens = 0
  let c1UniqueOpens = 0
  let c1Clicks = 0
  let c1UniqueClicks = 0

  c1Recipients.forEach((recipient, index) => {
    const sentAt = new Date(nineDaysAgo + index * 90_000).toISOString()
    const opened = random() < 0.46
    const clicked = opened && random() < 0.31
    const openCount = opened ? 1 + Math.floor(random() * 3) : 0
    const clickCount = clicked ? 1 : 0

    if (opened) {
      c1Opens += openCount
      c1UniqueOpens += 1
      recipient.openCount += openCount
      recipient.lastOpenAt = sentAt
    }
    if (clicked) {
      c1Clicks += clickCount
      c1UniqueClicks += 1
      recipient.clickCount += clickCount
      recipient.lastClickAt = sentAt
    }
    recipient.sentCount += 1

    const sendId = nextSendId++
    sends.push({
      id: sendId,
      campaignId: 1,
      campaignName: 'March product announcement',
      stepId: 1,
      stepName: 'Announcement',
      contactId: recipient.id,
      contactEmail: recipient.email,
      subject: c1Template.subject,
      status: 'sent',
      attempts: 1,
      error: null,
      messageId: `${index + 1}demo@maillocal.dev`,
      transport: 'memory',
      sendAfter: sentAt,
      sentAt,
      openedAt: opened ? sentAt : null,
      clickedAt: clicked ? sentAt : null,
      openCount,
      clickCount,
    })

    events.push({
      id: nextEventId++,
      kind: 'send.sent',
      campaignId: 1,
      campaignName: 'March product announcement',
      contactId: recipient.id,
      contactEmail: recipient.email,
      sendId,
      message: `${c1Template.subject} → ${recipient.email}`,
      meta: { email: recipient.email, transport: 'memory', campaignName: 'March product announcement' },
      createdAt: sentAt,
    })

    if (opened) {
      events.push({
        id: nextEventId++,
        kind: 'contact.opened',
        campaignId: 1,
        campaignName: 'March product announcement',
        contactId: recipient.id,
        contactEmail: recipient.email,
        sendId,
        message: `Opened: ${recipient.email}`,
        meta: { email: recipient.email },
        createdAt: sentAt,
      })
    }

    if (clicked) {
      events.push({
        id: nextEventId++,
        kind: 'contact.clicked',
        campaignId: 1,
        campaignName: 'March product announcement',
        contactId: recipient.id,
        contactEmail: recipient.email,
        sendId,
        message: 'Clicked https://example.com/changelog',
        meta: { email: recipient.email, url: 'https://example.com/changelog' },
        createdAt: sentAt,
      })
    }

    // Add first 5 sends to mailbox
    if (index < 5) {
      const renderedHtml = render(c1Template.html, {
        contact: { id: recipient.id, email: recipient.email, name: recipient.name, fields: recipient.fields },
        campaign: { name: 'March product announcement' },
        unsubscribeUrl: 'https://example.com/t/u/demo',
        now: new Date(sentAt),
      })
      mailbox.push({
        id: nextMailboxId++,
        toEmail: recipient.email,
        toName: recipient.name,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        subject: c1Template.subject,
        html: renderedHtml,
        text: htmlToText(renderedHtml),
        headers: {
          'message-id': `<${index + 1}demo@maillocal.dev>`,
          'to': `${recipient.name} <${recipient.email}>`,
          'from': `${settings.fromName} <${settings.fromEmail}>`,
          'subject': c1Template.subject,
        },
        messageId: `${index + 1}demo@maillocal.dev`,
        sendId,
        campaignId: 1,
        emlPath: null,
        simulatedOpenAt: opened ? sentAt : null,
        createdAt: sentAt,
      })
    }
  })

  // Bounced send for deleted mailbox
  const bouncer = contacts.find((c) => c.email === 'does-not-exist@acme-robotics.example')!
  const bounceSendId = nextSendId++
  const bounceTime = new Date(nineDaysAgo + 300_000).toISOString()
  sends.push({
    id: bounceSendId,
    campaignId: 1,
    campaignName: 'March product announcement',
    stepId: 1,
    stepName: 'Announcement',
    contactId: bouncer.id,
    contactEmail: bouncer.email,
    subject: c1Template.subject,
    status: 'bounced',
    attempts: 1,
    error: '550 5.1.1 recipient unknown',
    messageId: null,
    transport: 'memory',
    sendAfter: bounceTime,
    sentAt: null,
    openedAt: null,
    clickedAt: null,
    openCount: 0,
    clickCount: 0,
  })

  events.push({
    id: nextEventId++,
    kind: 'send.bounced',
    campaignId: 1,
    campaignName: 'March product announcement',
    contactId: bouncer.id,
    contactEmail: bouncer.email,
    sendId: bounceSendId,
    message: 'Bounced: does-not-exist@acme-robotics.example',
    meta: { email: bouncer.email },
    createdAt: bounceTime,
  })

  events.push({
    id: nextEventId++,
    kind: 'campaign.completed',
    campaignId: 1,
    campaignName: 'March product announcement',
    contactId: null,
    contactEmail: null,
    sendId: null,
    message: 'Completed: March product announcement',
    meta: { campaignName: 'March product announcement' },
    createdAt: c1CompletedAt,
  })

  const c1Sent = c1Recipients.length
  const c1Total = c1Sent + 1
  const c1Stats: CampaignStats = {
    recipients: c1Total,
    queued: 0,
    sending: 0,
    sent: c1Sent,
    delivered: c1Sent,
    failed: 0,
    bounced: 1,
    skipped: 0,
    opens: c1Opens,
    uniqueOpens: c1UniqueOpens,
    clicks: c1Clicks,
    uniqueClicks: c1UniqueClicks,
    unsubscribes: 0,
    openRate: c1Sent ? Math.round((c1UniqueOpens / c1Sent) * 1000) / 10 : 0,
    clickRate: c1Sent ? Math.round((c1UniqueClicks / c1Sent) * 1000) / 10 : 0,
    bounceRate: c1Total ? Math.round((1 / c1Total) * 1000) / 10 : 0,
    progress: 100,
    nextSendAt: null,
  }

  campaigns.push({
    id: 1,
    name: 'March product announcement',
    type: 'broadcast',
    status: 'completed',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    subject: c1Template.subject,
    segment: { listIds: [2, 3], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: c1Schedule,
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: null,
    startedAt: c1StartedAt,
    completedAt: c1CompletedAt,
    recipientCount: c1Total,
    createdAt: c1CreatedAt,
    updatedAt: c1CompletedAt,
    steps: [
      {
        id: 1,
        campaignId: 1,
        position: 0,
        name: 'Announcement',
        templateId: c1Template.id,
        subject: c1Template.subject,
        preheader: c1Template.preheader,
        html: c1Template.html,
        text: c1Template.text,
        delayMinutes: 0,
        skipIfOpened: false,
        skipIfClicked: false,
      },
    ],
    stats: c1Stats,
  })

  /* ── Campaign 2: Onboarding drip · 3 emails (running sequence) ───────────── */
  const c2Recipients = contacts.filter((c) => c.status === 'subscribed' && c.lists.some((l) => l.id === 1))
  const c2StartedAt = new Date(now.getTime() - 2 * 3_600_000).toISOString()
  const c2CreatedAt = new Date(now.getTime() - 24 * 3_600_000).toISOString()

  const c2Steps = [
    {
      id: 2,
      campaignId: 2,
      position: 0,
      name: 'Day 0 · welcome',
      templateId: templates[0]!.id,
      subject: templates[0]!.subject,
      preheader: templates[0]!.preheader,
      html: templates[0]!.html,
      text: templates[0]!.text,
      delayMinutes: 0,
      skipIfOpened: false,
      skipIfClicked: false,
    },
    {
      id: 3,
      campaignId: 2,
      position: 1,
      name: 'Day 2 · webinar',
      templateId: templates[3]!.id,
      subject: templates[3]!.subject,
      preheader: templates[3]!.preheader,
      html: templates[3]!.html,
      text: templates[3]!.text,
      delayMinutes: 2880,
      skipIfOpened: false,
      skipIfClicked: false,
    },
    {
      id: 4,
      campaignId: 2,
      position: 2,
      name: 'Day 7 · trial ending',
      templateId: templates[1]!.id,
      subject: templates[1]!.subject,
      preheader: templates[1]!.preheader,
      html: templates[1]!.html,
      text: templates[1]!.text,
      delayMinutes: 7200,
      skipIfOpened: false,
      skipIfClicked: true,
    },
  ]

  events.push({
    id: nextEventId++,
    kind: 'campaign.created',
    campaignId: 2,
    campaignName: 'Onboarding drip · 3 emails',
    contactId: null,
    contactEmail: null,
    sendId: null,
    message: 'Draft “Onboarding drip · 3 emails” created',
    meta: { campaignName: 'Onboarding drip · 3 emails' },
    createdAt: c2CreatedAt,
  })

  events.push({
    id: nextEventId++,
    kind: 'campaign.started',
    campaignId: 2,
    campaignName: 'Onboarding drip · 3 emails',
    contactId: null,
    contactEmail: null,
    sendId: null,
    message: `Started — ${c2Recipients.length * 3} message(s) queued`,
    meta: { queued: c2Recipients.length * 3, scheduled: false, campaignName: 'Onboarding drip · 3 emails' },
    createdAt: c2StartedAt,
  })

  // Generate sends for running onboarding campaign:
  // step 1 sent, step 2 & 3 queued
  let c2SentCount = 0
  let c2QueuedCount = 0
  let c2UniqueOpens = 0
  let c2UniqueClicks = 0

  c2Recipients.forEach((recipient, rIdx) => {
    // Step 0: sent
    const send0Id = nextSendId++
    const sentAt = new Date(now.getTime() - 2 * 3_600_000 + rIdx * 60_000).toISOString()
    const opened = rIdx % 2 === 0
    const clicked = opened && rIdx % 4 === 0
    if (opened) c2UniqueOpens++
    if (clicked) c2UniqueClicks++

    sends.push({
      id: send0Id,
      campaignId: 2,
      campaignName: 'Onboarding drip · 3 emails',
      stepId: 2,
      stepName: 'Day 0 · welcome',
      contactId: recipient.id,
      contactEmail: recipient.email,
      subject: c2Steps[0]!.subject,
      status: 'sent',
      attempts: 1,
      error: null,
      messageId: `onboard-${rIdx}-1@maillocal.dev`,
      transport: 'memory',
      sendAfter: sentAt,
      sentAt,
      openedAt: opened ? sentAt : null,
      clickedAt: clicked ? sentAt : null,
      openCount: opened ? 1 : 0,
      clickCount: clicked ? 1 : 0,
    })
    c2SentCount++

    // Mailbox sample for onboarding
    if (rIdx < 3) {
      const renderedHtml = render(c2Steps[0]!.html, {
        contact: { id: recipient.id, email: recipient.email, name: recipient.name, fields: recipient.fields },
        campaign: { name: 'Onboarding drip · 3 emails' },
        unsubscribeUrl: 'https://example.com/t/u/demo',
        now: new Date(sentAt),
      })
      mailbox.push({
        id: nextMailboxId++,
        toEmail: recipient.email,
        toName: recipient.name,
        fromEmail: settings.fromEmail,
        fromName: settings.fromName,
        replyTo: settings.replyTo,
        subject: render(c2Steps[0]!.subject, { contact: recipient }),
        html: renderedHtml,
        text: htmlToText(renderedHtml),
        headers: {
          'message-id': `<onboard-${rIdx}-1@maillocal.dev>`,
          'to': `${recipient.name} <${recipient.email}>`,
          'from': `${settings.fromName} <${settings.fromEmail}>`,
          'subject': render(c2Steps[0]!.subject, { contact: recipient }),
        },
        messageId: `onboard-${rIdx}-1@maillocal.dev`,
        sendId: send0Id,
        campaignId: 2,
        emlPath: null,
        simulatedOpenAt: opened ? sentAt : null,
        createdAt: sentAt,
      })
    }

    // Step 1: queued (due in 2 days)
    const send1After = new Date(now.getTime() + 2 * 86_400_000).toISOString()
    sends.push({
      id: nextSendId++,
      campaignId: 2,
      campaignName: 'Onboarding drip · 3 emails',
      stepId: 3,
      stepName: 'Day 2 · webinar',
      contactId: recipient.id,
      contactEmail: recipient.email,
      subject: c2Steps[1]!.subject,
      status: 'queued',
      attempts: 0,
      error: null,
      messageId: null,
      transport: null,
      sendAfter: send1After,
      sentAt: null,
      openedAt: null,
      clickedAt: null,
      openCount: 0,
      clickCount: 0,
    })
    c2QueuedCount++

    // Step 2: queued (due in 7 days)
    const send2After = new Date(now.getTime() + 7 * 86_400_000).toISOString()
    sends.push({
      id: nextSendId++,
      campaignId: 2,
      campaignName: 'Onboarding drip · 3 emails',
      stepId: 4,
      stepName: 'Day 7 · trial ending',
      contactId: recipient.id,
      contactEmail: recipient.email,
      subject: c2Steps[2]!.subject,
      status: 'queued',
      attempts: 0,
      error: null,
      messageId: null,
      transport: null,
      sendAfter: send2After,
      sentAt: null,
      openedAt: null,
      clickedAt: null,
      openCount: 0,
      clickCount: 0,
    })
    c2QueuedCount++
  })

  const c2Total = c2Recipients.length * 3
  const c2Stats: CampaignStats = {
    recipients: c2Total,
    queued: c2QueuedCount,
    sending: 0,
    sent: c2SentCount,
    delivered: c2SentCount,
    failed: 0,
    bounced: 0,
    skipped: 0,
    opens: c2UniqueOpens,
    uniqueOpens: c2UniqueOpens,
    clicks: c2UniqueClicks,
    uniqueClicks: c2UniqueClicks,
    unsubscribes: 0,
    openRate: c2SentCount ? Math.round((c2UniqueOpens / c2SentCount) * 1000) / 10 : 0,
    clickRate: c2SentCount ? Math.round((c2UniqueClicks / c2SentCount) * 1000) / 10 : 0,
    bounceRate: 0,
    progress: c2Total ? Math.round((c2SentCount / c2Total) * 1000) / 10 : 0,
    nextSendAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
  }

  campaigns.push({
    id: 2,
    name: 'Onboarding drip · 3 emails',
    type: 'sequence',
    status: 'running',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    subject: c2Steps[0]!.subject,
    segment: { listIds: [1], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: 'UTC', ratePerMinute: 20, dailyCap: 500, skipWeekends: false, startAt: null, windowStartHour: null, windowEndHour: null },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: null,
    startedAt: c2StartedAt,
    completedAt: null,
    recipientCount: c2Recipients.length,
    createdAt: c2CreatedAt,
    updatedAt: nowIso,
    steps: c2Steps,
    stats: c2Stats,
  })

  /* ── Campaign 3: Win-back · quiet subscribers (scheduled broadcast) ──────── */
  const c3Template = templates[4]!
  const c3StartAt = new Date(now.getTime() + 3 * 3_600_000).toISOString()
  const c3Recipients = contacts.filter((c) => c.status === 'subscribed' && c.lists.some((l) => l.id === 3))

  campaigns.push({
    id: 3,
    name: 'Win-back · quiet subscribers',
    type: 'broadcast',
    status: 'scheduled',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    subject: c3Template.subject,
    segment: { listIds: [3], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: 'UTC', ratePerMinute: 15, dailyCap: 300, skipWeekends: true, startAt: c3StartAt, windowStartHour: 9, windowEndHour: 18 },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: c3StartAt,
    startedAt: null,
    completedAt: null,
    recipientCount: c3Recipients.length,
    createdAt: nowIso,
    updatedAt: nowIso,
    steps: [
      {
        id: 5,
        campaignId: 3,
        position: 0,
        name: 'Check-in',
        templateId: c3Template.id,
        subject: c3Template.subject,
        preheader: c3Template.preheader,
        html: c3Template.html,
        text: c3Template.text,
        delayMinutes: 0,
        skipIfOpened: false,
        skipIfClicked: false,
      },
    ],
    stats: {
      recipients: c3Recipients.length,
      queued: c3Recipients.length,
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
      nextSendAt: c3StartAt,
    },
  })

  c3Recipients.forEach((recipient) => {
    sends.push({
      id: nextSendId++,
      campaignId: 3,
      campaignName: 'Win-back · quiet subscribers',
      stepId: 5,
      stepName: 'Check-in',
      contactId: recipient.id,
      contactEmail: recipient.email,
      subject: c3Template.subject,
      status: 'queued',
      attempts: 0,
      error: null,
      messageId: null,
      transport: null,
      sendAfter: c3StartAt,
      sentAt: null,
      openedAt: null,
      clickedAt: null,
      openCount: 0,
      clickCount: 0,
    })
  })

  /* ── Campaign 4: April newsletter (draft broadcast) ───────────────────────── */
  const c4Template = templates[5]!
  campaigns.push({
    id: 4,
    name: 'April newsletter (draft)',
    type: 'broadcast',
    status: 'draft',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    subject: c4Template.subject,
    segment: { listIds: [1, 2, 3], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: 'UTC', ratePerMinute: 30, dailyCap: 2000, skipWeekends: false, startAt: null, windowStartHour: null, windowEndHour: null },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: null,
    startedAt: null,
    completedAt: null,
    recipientCount: contacts.filter((c) => c.status === 'subscribed').length,
    createdAt: nowIso,
    updatedAt: nowIso,
    steps: [
      {
        id: 6,
        campaignId: 4,
        position: 0,
        name: 'Email 1',
        templateId: c4Template.id,
        subject: c4Template.subject,
        preheader: c4Template.preheader,
        html: c4Template.html,
        text: c4Template.text,
        delayMinutes: 0,
        skipIfOpened: false,
        skipIfClicked: false,
      },
    ],
    stats: {
      recipients: contacts.filter((c) => c.status === 'subscribed').length,
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
  })

  // Calculate list contact counts
  for (const list of lists) {
    const listContacts = contacts.filter((c) => c.lists.some((l) => l.id === list.id))
    list.contactCount = listContacts.length
    list.subscribedCount = listContacts.filter((c) => c.status === 'subscribed').length
    list.unsubscribeCount = listContacts.filter((c) => c.status !== 'subscribed').length
  }

  // Calculate tag contact counts
  for (const tag of tags) {
    tag.contactCount = contacts.filter((c) => c.tags.some((t) => t.id === tag.id)).length
  }

  return {
    user,
    settings,
    lists,
    tags,
    contacts,
    templates,
    campaigns,
    sends,
    events,
    mailbox,
    engine: {
      running: false,
      lastTickAt: new Date(nineDaysAgo + 22 * 90_000).toISOString(),
      tickDurationMs: 5,
      lifetime: {
        sent: c1Sent + c2SentCount,
        failed: 0,
        skipped: 0,
      },
    },
  }
}
