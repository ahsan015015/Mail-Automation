import { getDb, openDatabase, useDatabase } from './sqlite.js'
import { config } from '../lib/config.js'
import { logger } from '../lib/log.js'
import { nowIso } from '../lib/util.js'
import { ensureBootstrapAdmin } from '../services/auth.js'
import { createList, createTag } from '../services/lists.js'
import { createContact, importCsv } from '../services/contacts.js'
import { createTemplate } from '../services/templates.js'
import { createCampaign, startCampaign } from '../services/campaigns.js'
import { recordEvent } from '../services/events.js'
import { getSettings } from '../services/settings.js'

/**
 * Demo content for an empty workspace: three lists, realistic subscribers,
 * six templates and four campaigns at different lifecycle stages, plus two
 * weeks of historical engagement so the dashboard is meaningful immediately.
 */

const FIRST = ['Ahsan', 'Mira', 'Daniel', 'Sofia', 'Yuki', 'Noah', 'Lena', 'Omar', 'Priya', 'Jonas', 'Amara', 'Ivan', 'Chen', 'Fatima', 'Lucas', 'Nora', 'Tariq', 'Elif', 'Marco', 'Zara', 'Kwame', 'Ines', 'Ravi', 'Hana', 'Felix', 'Aisha', 'Bruno', 'Sara', 'Kenji', 'Nadia']
const LAST = ['Rahman', 'Kowalski', 'Okafor', 'Rossi', 'Tanaka', 'Bennett', 'Fischer', 'Haddad', 'Nair', 'Lindqvist', 'Diallo', 'Petrov', 'Wei', 'Ahmadi', 'Silva', 'Holm', 'Aziz', 'Yilmaz', 'Bianchi', 'Ali', 'Mensah', 'Costa', 'Iyer', 'Sato', 'Baumann', 'Farouk', 'Almeida', 'Novak', 'Mori', 'Hussein']

const COMPANIES = ['Northwind', 'Globex', 'Initech', 'Umbrella Labs', 'Hooli', 'Vandelay', 'Acme Robotics', 'Lumen', 'Bluepeak', 'Orbital']
const PLANS = ['Free', 'Starter', 'Pro', 'Scale']

const seededRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

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

const DEMO_CSV = FIRST.map((first, index) => {
  const last = LAST[index % LAST.length]
  const company = COMPANIES[index % COMPANIES.length]
  const plan = PLANS[index % PLANS.length]
  const tag = ['trial', 'customer', 'newsletter'][index % 3]
  return `${first.toLowerCase()}.${last.toLowerCase()}@${company.toLowerCase().replace(/[^a-z]/g, '')}.example,${first} ${last},${plan},${company},${tag}`
}).join('\n')

export interface SeedResult {
  skipped: boolean
  contacts: number
  lists: number
  templates: number
  campaigns: number
  historicalSends: number
}

export function seedDemoData(options: { force?: boolean } = {}): SeedResult {
  const db = getDb()
  const alreadyPopulated = db.count('SELECT COUNT(*) FROM contacts') > 0
  if (alreadyPopulated && !options.force) {
    return { skipped: true, contacts: db.count('SELECT COUNT(*) FROM contacts'), lists: db.count('SELECT COUNT(*) FROM lists'), templates: db.count('SELECT COUNT(*) FROM templates'), campaigns: db.count('SELECT COUNT(*) FROM campaigns'), historicalSends: 0 }
  }

  const random = seededRandom(20260830)
  const settings = getSettings()

  const trial = createList({ name: 'Trial users', description: 'Signed up in the last 30 days, no plan yet.' })
  const customers = createList({ name: 'Customers', description: 'Paying workspaces — billing, product updates.' })
  const newsletter = createList({ name: 'Newsletter', description: 'Monthly digest subscribers who opted in.' })

  for (const tag of ['trial', 'customer', 'newsletter', 'vip', 'webinar', 'cold']) createTag(tag)

  const imported = importCsv({
    csv: `email,name,plan,company,tags\n${DEMO_CSV}`,
    listId: newsletter.id,
    tags: ['newsletter'],
  })

  // split the imported audience across the three lists
  const contactIds = db.all<{ id: number }>('SELECT id FROM contacts ORDER BY id').map((row) => row.id)
  contactIds.forEach((id, index) => {
    const listId = index % 3 === 0 ? trial.id : index % 3 === 1 ? customers.id : newsletter.id
    db.run('INSERT OR IGNORE INTO contact_lists (contact_id, list_id, added_at) VALUES (?, ?, ?)', id, listId, nowIso())
  })

  // a couple of hand-written records exercise the single-contact path too
  createContact({ email: 'sam.diallo@hooli.example', name: 'Sam Diallo', fields: { plan: 'Scale', company: 'Hooli' }, listIds: [customers.id], tags: ['vip'] })
  createContact({ email: 'unsubscribe.me@example.com', name: 'Riley Optout', listIds: [newsletter.id], status: 'unsubscribed' })

  const templates = TEMPLATES.map((template) => createTemplate({ ...template, text: '' }))

  /* ── historical campaign: already completed, with realistic engagement ───── */

  const announcement = createCampaign({
    name: 'March product announcement',
    type: 'broadcast',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    segment: { listIds: [customers.id, newsletter.id], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: settings.sending.timezone, ratePerMinute: 60, dailyCap: 5000, skipWeekends: false, startAt: null, windowStartHour: null, windowEndHour: null },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    steps: [{ name: 'Announcement', delayMinutes: 0, templateId: templates[2]!.id, subject: templates[2]!.subject, html: templates[2]!.html, preheader: templates[2]!.preheader }],
  })

  const recipients = db.all<{ id: number; email: string }>(
    `SELECT DISTINCT c.id, c.email FROM contacts c JOIN contact_lists cl ON cl.contact_id = c.id
     WHERE cl.list_id IN (?, ?) AND c.status = 'subscribed' ORDER BY c.id`,
    customers.id,
    newsletter.id,
  )

  let historySends = 0
  db.transaction(() => {
    const step = db.get<{ id: number }>('SELECT id FROM steps WHERE campaign_id = ? ORDER BY position LIMIT 1', announcement.id)!
    const start = Date.now() - 9 * 86_400_000
    recipients.forEach((recipient, index) => {
      const sentAt = new Date(start + index * 90_000).toISOString()
      const opened = random() < 0.46
      const clicked = opened && random() < 0.31
      const insert = db.run(
        `INSERT OR IGNORE INTO sends (campaign_id, step_id, contact_id, to_email, subject, status, attempts, message_id, transport,
                            send_after, sent_at, opened_at, clicked_at, open_count, click_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'sent', 1, ?, 'memory', ?, ?, ?, ?, ?, ?, ?, ?)`,
        announcement.id,
        step.id,
        recipient.id,
        recipient.email,
        templates[2]!.subject,
        `${index + 1}demo@maillocal.dev`,
        sentAt,
        sentAt,
        opened ? sentAt : null,
        clicked ? sentAt : null,
        opened ? 1 + Math.floor(random() * 3) : 0,
        clicked ? 1 : 0,
        sentAt,
        sentAt,
      )
      historySends += insert.changes
      if (opened) {
        recordEvent({ kind: 'contact.opened', campaignId: announcement.id, contactId: recipient.id, sendId: insert.lastInsertRowid, message: `Opened: ${recipient.email}`, meta: { email: recipient.email } })
      }
      if (clicked) {
        recordEvent({ kind: 'contact.clicked', campaignId: announcement.id, contactId: recipient.id, sendId: insert.lastInsertRowid, message: 'Clicked https://example.com/changelog', meta: { email: recipient.email, url: 'https://example.com/changelog' } })
      }
    })
    const iso = new Date(start + recipients.length * 90_000 + 60_000).toISOString()
    db.run(`UPDATE campaigns SET status = 'completed', started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?`, new Date(start).toISOString(), iso, iso, announcement.id)
    // two hard bounces + a few unsubscribes, so the numbers are not suspiciously perfect
    const bouncer = createContact({ email: 'does-not-exist@acme-robotics.example', name: 'Deleted Mailbox', listIds: [customers.id], status: 'subscribed' })
    db.run(
      `INSERT OR IGNORE INTO sends (campaign_id, step_id, contact_id, to_email, subject, status, attempts, error, send_after, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, 'bounced', 1, '550 5.1.1 recipient unknown', ?, ?, ?)`,
      announcement.id,
      bouncer.id,
      bouncer.email,
      templates[2]!.subject,
      new Date(start + 300_000).toISOString(),
      new Date(start).toISOString(),
      new Date(start + 300_000).toISOString(),
    )
    recordEvent({ kind: 'send.bounced', campaignId: announcement.id, contactId: bouncer.id, message: 'Bounced: does-not-exist@acme-robotics.example', meta: { email: bouncer.email } })
    historySends += 1
  })

  recordEvent({ kind: 'campaign.completed', campaignId: announcement.id, message: `Completed: ${announcement.name}`, meta: { campaignName: announcement.name } })

  /* ── live drip: starts as soon as the engine ticks ────────────────────────── */

  const onboarding = createCampaign({
    name: 'Onboarding drip · 3 emails',
    type: 'sequence',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    segment: { listIds: [trial.id], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: settings.sending.timezone, ratePerMinute: 20, dailyCap: 500, skipWeekends: false, startAt: null, windowStartHour: null, windowEndHour: null },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    steps: [
      { name: 'Day 0 · welcome', delayMinutes: 0, templateId: templates[0]!.id, subject: templates[0]!.subject, html: templates[0]!.html, preheader: templates[0]!.preheader },
      { name: 'Day 2 · webinar', delayMinutes: 2 * 24 * 60, templateId: templates[3]!.id, subject: templates[3]!.subject, html: templates[3]!.html, preheader: templates[3]!.preheader, skipIfOpened: false },
      { name: 'Day 7 · trial ending', delayMinutes: 5 * 24 * 60, templateId: templates[1]!.id, subject: templates[1]!.subject, html: templates[1]!.html, preheader: templates[1]!.preheader, skipIfClicked: true },
    ],
  })
  startCampaign(onboarding.id)

  /* ── scheduled + draft, to exercise the other states ─────────────────────── */

  const winback = createCampaign({
    name: 'Win-back · quiet subscribers',
    type: 'broadcast',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    segment: { listIds: [newsletter.id], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    schedule: { timezone: settings.sending.timezone, ratePerMinute: 15, dailyCap: 300, skipWeekends: true, startAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), windowStartHour: 9, windowEndHour: 18 },
    tracking: { openTracking: true, clickTracking: true, includeUnsubscribe: true },
    scheduledStartAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    steps: [{ name: 'Check-in', delayMinutes: 0, templateId: templates[4]!.id, subject: templates[4]!.subject, html: templates[4]!.html, preheader: templates[4]!.preheader }],
  })
  startCampaign(winback.id)

  createCampaign({
    name: 'April newsletter (draft)',
    type: 'broadcast',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    segment: { listIds: [newsletter.id, trial.id, customers.id], tagIds: [], tagMatch: 'any', excludeListIds: [], excludeTagIds: [], statuses: ['subscribed'] },
    steps: [{ name: 'Email 1', delayMinutes: 0, templateId: templates[5]!.id, subject: templates[5]!.subject, html: templates[5]!.html, preheader: templates[5]!.preheader }],
  })

  logger.info(
    `seed: ${imported.created + 2} contacts, ${db.count('SELECT COUNT(*) FROM lists')} lists, ${templates.length} templates, ${db.count('SELECT COUNT(*) FROM campaigns')} campaigns (${historySends} historical sends)`,
  )

  return {
    skipped: false,
    contacts: db.count('SELECT COUNT(*) FROM contacts'),
    lists: db.count('SELECT COUNT(*) FROM lists'),
    templates: templates.length,
    campaigns: db.count('SELECT COUNT(*) FROM campaigns'),
    historicalSends: historySends,
  }
}

/* CLI: `npm run seed` */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  const force = process.argv.includes('--force')
  if (force) {
    const fresh = openDatabase(config.dbPath)
    useDatabase(fresh)
    fresh.exec('DELETE FROM sends; DELETE FROM events; DELETE FROM mailbox; DELETE FROM steps; DELETE FROM campaigns; DELETE FROM templates; DELETE FROM contact_tags; DELETE FROM contact_lists; DELETE FROM contacts; DELETE FROM tags; DELETE FROM lists; DELETE FROM settings;')
  }
  const db = getDb()
  ensureBootstrapAdmin()
  const result = seedDemoData({ force })
  const summary = force ? 'reseeded' : result.skipped ? 'skipped (workspace already has contacts)' : 'seeded'
  // eslint-disable-next-line no-console
  console.log(
    `mail-automation seed → ${summary}\n  contacts:  ${result.contacts}\n  lists:     ${result.lists}\n  templates: ${result.templates}\n  campaigns: ${result.campaigns}\n  db:        ${db.stats().file}`,
  )
  if (config.seedDemo && !result.skipped) logger.info('SEED_DEMO is on; the same data is created automatically on first start')
}
