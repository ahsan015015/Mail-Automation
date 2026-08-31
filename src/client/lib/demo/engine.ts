import type { MailboxMessageDto, SendDto } from '@shared/types'
import { render } from '../../../server/lib/merge'
import { htmlToText } from '../../../server/lib/html'
import type { DemoStore } from './store'
import { recomputeCampaignStats } from './helpers'

export function simulateTick(store: DemoStore): { processed: number; sent: number; failed: number; skipped: number } {
  const now = new Date()
  const nowIso = now.toISOString()
  let sentCount = 0
  let skippedCount = 0

  // 1. Activate scheduled campaigns whose start time has arrived
  for (const campaign of store.campaigns) {
    if (campaign.status === 'scheduled' && campaign.scheduledStartAt) {
      if (new Date(campaign.scheduledStartAt) <= now) {
        campaign.status = 'running'
        campaign.startedAt = nowIso
        campaign.updatedAt = nowIso
        const nextEventId = Math.max(0, ...store.events.map((e) => e.id)) + 1
        store.events.unshift({
          id: nextEventId,
          kind: 'campaign.started',
          campaignId: campaign.id,
          campaignName: campaign.name,
          contactId: null,
          contactEmail: null,
          sendId: null,
          message: 'Scheduled start reached — sending',
          meta: { campaignName: campaign.name },
          createdAt: nowIso,
        })
      }
    }
  }

  // 2. Process due queued sends for running campaigns
  const runningCampaigns = store.campaigns.filter((c) => c.status === 'running')
  const runningCampaignIds = new Set(runningCampaigns.map((c) => c.id))

  const dueSends = store.sends
    .filter((s) => runningCampaignIds.has(s.campaignId) && s.status === 'queued' && new Date(s.sendAfter) <= now)
    .sort((a, b) => new Date(a.sendAfter).getTime() - new Date(b.sendAfter).getTime() || a.id - b.id)
    .slice(0, 40)

  for (const send of dueSends) {
    const campaign = store.campaigns.find((c) => c.id === send.campaignId)
    const contact = store.contacts.find((c) => c.id === send.contactId)
    const step = campaign?.steps.find((s) => s.id === send.stepId) ?? campaign?.steps[0]

    if (!campaign || !contact) {
      send.status = 'skipped'
      send.error = 'contact or campaign missing'
      store.engine.lifetime.skipped += 1
      skippedCount++
      continue
    }

    const allowedStatuses = campaign.segment.statuses?.length ? campaign.segment.statuses : ['subscribed']
    if (!allowedStatuses.includes(contact.status)) {
      send.status = 'skipped'
      send.error = `contact status is ${contact.status}`
      store.engine.lifetime.skipped += 1
      skippedCount++
      continue
    }

    // Drip skip conditions
    if (step?.skipIfOpened) {
      const openedEarlier = store.sends.some(
        (prev) => prev.campaignId === campaign.id && prev.contactId === contact.id && (prev.openCount ?? 0) > 0,
      )
      if (openedEarlier) {
        send.status = 'skipped'
        send.error = 'contact already opened an earlier email'
        store.engine.lifetime.skipped += 1
        skippedCount++
        continue
      }
    }

    if (step?.skipIfClicked) {
      const clickedEarlier = store.sends.some(
        (prev) => prev.campaignId === campaign.id && prev.contactId === contact.id && (prev.clickCount ?? 0) > 0,
      )
      if (clickedEarlier) {
        send.status = 'skipped'
        send.error = 'contact already clicked an earlier email'
        store.engine.lifetime.skipped += 1
        skippedCount++
        continue
      }
    }

    // Deliver send
    const ctx = {
      contact: { id: contact.id, email: contact.email, name: contact.name, fields: contact.fields },
      campaign: { name: campaign.name },
      unsubscribeUrl: 'https://example.com/t/u/demo',
      now,
    }

    const html = render(step?.html || '', ctx)
    const subject = render(step?.subject || send.subject || campaign.name, ctx)
    const text = render(step?.text || htmlToText(html), ctx)

    const messageId = `${send.id}-${Date.now()}@demo.local`
    const nextMailboxId = Math.max(0, ...store.mailbox.map((m) => m.id)) + 1
    const mailboxMessage: MailboxMessageDto = {
      id: nextMailboxId,
      toEmail: contact.email,
      toName: contact.name,
      fromEmail: campaign.fromEmail,
      fromName: campaign.fromName,
      replyTo: campaign.replyTo,
      subject,
      html,
      text,
      headers: {
        'message-id': `<${messageId}>`,
        'to': `${contact.name} <${contact.email}>`,
        'from': `${campaign.fromName} <${campaign.fromEmail}>`,
        'subject': subject,
      },
      messageId,
      sendId: send.id,
      campaignId: campaign.id,
      emlPath: null,
      simulatedOpenAt: null,
      createdAt: nowIso,
    }
    store.mailbox.unshift(mailboxMessage)

    send.status = 'sent'
    send.sentAt = nowIso
    send.attempts = (send.attempts || 0) + 1
    send.messageId = messageId
    send.transport = 'memory'
    send.subject = subject
    send.error = null

    contact.sentCount = (contact.sentCount || 0) + 1
    contact.updatedAt = nowIso

    store.engine.lifetime.sent += 1
    sentCount++

    const nextEventId = Math.max(0, ...store.events.map((e) => e.id)) + 1
    store.events.unshift({
      id: nextEventId,
      kind: 'send.sent',
      campaignId: campaign.id,
      campaignName: campaign.name,
      contactId: contact.id,
      contactEmail: contact.email,
      sendId: send.id,
      message: `${subject} → ${contact.email}`,
      meta: { email: contact.email, transport: 'memory', campaignName: campaign.name },
      createdAt: nowIso,
    })
  }

  // 3. Finalize campaigns that have no remaining queued or sending sends
  for (const campaign of runningCampaigns) {
    const remaining = store.sends.filter(
      (s) => s.campaignId === campaign.id && (s.status === 'queued' || s.status === 'sending'),
    ).length
    if (remaining === 0) {
      campaign.status = 'completed'
      campaign.completedAt = nowIso
      campaign.updatedAt = nowIso
      const nextEventId = Math.max(0, ...store.events.map((e) => e.id)) + 1
      store.events.unshift({
        id: nextEventId,
        kind: 'campaign.completed',
        campaignId: campaign.id,
        campaignName: campaign.name,
        contactId: null,
        contactEmail: null,
        sendId: null,
        message: `Completed: ${campaign.name}`,
        meta: { campaignName: campaign.name },
        createdAt: nowIso,
      })
    }
    campaign.stats = recomputeCampaignStats(campaign.id, store)
  }

  store.engine.lastTickAt = nowIso
  store.engine.tickDurationMs = 2

  return {
    processed: sentCount + skippedCount,
    sent: sentCount,
    failed: 0,
    skipped: skippedCount,
  }
}

export function simulateDrain(store: DemoStore, maxRounds = 40): { processed: number; sent: number; failed: number; skipped: number } {
  let totalProcessed = 0
  let totalSent = 0
  let totalFailed = 0
  let totalSkipped = 0

  for (let round = 0; round < maxRounds; round++) {
    const result = simulateTick(store)
    totalProcessed += result.processed
    totalSent += result.sent
    totalFailed += result.failed
    totalSkipped += result.skipped
    if (result.processed === 0) break
  }

  return {
    processed: totalProcessed,
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
  }
}
