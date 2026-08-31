import type {
  CampaignStats,
  ContactDto,
  EventDto,
  EventKind,
  FunnelPoint,
  Paged,
  Segment,
} from '@shared/types'
import type { DemoStore } from './store'

export const nowIso = (): string => new Date().toISOString()

export const rate = (num: number, denom: number): number =>
  denom ? Math.round((num / denom) * 1000) / 10 : 0

export const round = (num: number, digits = 1): number =>
  Math.round(num * 10 ** digits) / 10 ** digits

export function randomToken(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

export function matchesSegment(contact: ContactDto, segment?: Partial<Segment>): boolean {
  if (!segment) return true
  const statuses = segment.statuses?.length ? segment.statuses : ['subscribed']
  if (!statuses.includes(contact.status)) return false

  const contactListIds = contact.lists.map((l) => l.id)
  const contactTagIds = contact.tags.map((t) => t.id)

  if (segment.listIds?.length) {
    const hasIncludedList = segment.listIds.some((id) => contactListIds.includes(id))
    if (!hasIncludedList) return false
  }

  if (segment.tagIds?.length) {
    if (segment.tagMatch === 'all') {
      const hasAllTags = segment.tagIds.every((id) => contactTagIds.includes(id))
      if (!hasAllTags) return false
    } else {
      const hasAnyTag = segment.tagIds.some((id) => contactTagIds.includes(id))
      if (!hasAnyTag) return false
    }
  }

  if (segment.excludeListIds?.length) {
    const hasExcludedList = segment.excludeListIds.some((id) => contactListIds.includes(id))
    if (hasExcludedList) return false
  }

  if (segment.excludeTagIds?.length) {
    const hasExcludedTag = segment.excludeTagIds.some((id) => contactTagIds.includes(id))
    if (hasExcludedTag) return false
  }

  return true
}

export function recomputeCampaignStats(campaignId: number, store: DemoStore): CampaignStats {
  const campaignSends = store.sends.filter((s) => s.campaignId === campaignId)
  const queued = campaignSends.filter((s) => s.status === 'queued').length
  const sending = campaignSends.filter((s) => s.status === 'sending').length
  const sent = campaignSends.filter((s) => s.status === 'sent').length
  const failed = campaignSends.filter((s) => s.status === 'failed').length
  const bounced = campaignSends.filter((s) => s.status === 'bounced').length
  const skipped = campaignSends.filter((s) => s.status === 'skipped').length

  let opens = 0
  let uniqueOpens = 0
  let clicks = 0
  let uniqueClicks = 0
  let nextSendAt: string | null = null

  for (const s of campaignSends) {
    if ((s.openCount ?? 0) > 0) {
      opens += s.openCount
      uniqueOpens += 1
    }
    if ((s.clickCount ?? 0) > 0) {
      clicks += s.clickCount
      uniqueClicks += 1
    }
    if (s.status === 'queued') {
      if (!nextSendAt || new Date(s.sendAfter) < new Date(nextSendAt)) {
        nextSendAt = s.sendAfter
      }
    }
  }

  const unsubscribes = store.events.filter(
    (e) => e.campaignId === campaignId && e.kind === 'contact.unsubscribed',
  ).length
  const total = campaignSends.length
  const terminal = sent + bounced + failed + skipped

  return {
    recipients: total,
    queued,
    sending,
    sent,
    delivered: sent,
    failed,
    bounced,
    skipped,
    opens,
    uniqueOpens,
    clicks,
    uniqueClicks,
    unsubscribes,
    openRate: rate(uniqueOpens, sent),
    clickRate: rate(uniqueClicks, sent),
    bounceRate: rate(bounced, sent + bounced),
    progress: total ? round((terminal / total) * 100, 1) : 0,
    nextSendAt,
  }
}

export function recomputeListCounts(store: DemoStore): void {
  for (const list of store.lists) {
    const listContacts = store.contacts.filter((c) => c.lists.some((l) => l.id === list.id))
    list.contactCount = listContacts.length
    list.subscribedCount = listContacts.filter((c) => c.status === 'subscribed').length
    list.unsubscribeCount = listContacts.filter((c) => c.status !== 'subscribed').length
  }
}

export function recomputeTagCounts(store: DemoStore): void {
  for (const tag of store.tags) {
    tag.contactCount = store.contacts.filter((c) => c.tags.some((t) => t.id === tag.id)).length
  }
}

export function recordEvent(
  store: DemoStore,
  input: {
    kind: EventKind
    message: string
    campaignId?: number | null
    contactId?: number | null
    sendId?: number | null
    meta?: Record<string, unknown>
  },
): EventDto {
  const nextId = Math.max(0, ...store.events.map((e) => e.id)) + 1
  const campaign = input.campaignId ? store.campaigns.find((c) => c.id === input.campaignId) : null
  const contact = input.contactId ? store.contacts.find((c) => c.id === input.contactId) : null

  const event: EventDto = {
    id: nextId,
    kind: input.kind,
    campaignId: input.campaignId ?? null,
    campaignName: campaign?.name ?? (input.meta?.campaignName as string) ?? null,
    contactId: input.contactId ?? null,
    contactEmail: contact?.email ?? (input.meta?.email as string) ?? null,
    sendId: input.sendId ?? null,
    message: input.message,
    meta: input.meta ?? {},
    createdAt: nowIso(),
  }

  store.events.unshift(event)
  return event
}

export function paginate<T>(items: T[], page = 1, perPage = 25): Paged<T> {
  const safePage = Math.max(1, Number(page) || 1)
  const safePerPage = Math.max(1, Number(perPage) || 25)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / safePerPage))
  const start = (safePage - 1) * safePerPage
  const paginatedItems = items.slice(start, start + safePerPage)

  return {
    items: paginatedItems,
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages,
  }
}

export function funnelFor(campaignId: number, store: DemoStore): FunnelPoint[] {
  const campaignSends = store.sends.filter((s) => s.campaignId === campaignId)
  const total = campaignSends.length || 1
  const delivered = campaignSends.filter((s) => s.status === 'sent' || s.status === 'bounced').length
  const opened = campaignSends.filter((s) => (s.openCount ?? 0) > 0).length
  const clicked = campaignSends.filter((s) => (s.clickCount ?? 0) > 0).length

  return [
    { label: 'Queued', value: total, percent: 100 },
    { label: 'Delivered', value: delivered, percent: round((delivered / total) * 100, 1) },
    { label: 'Opened', value: opened, percent: round((opened / total) * 100, 1) },
    { label: 'Clicked', value: clicked, percent: round((clicked / total) * 100, 1) },
  ]
}

export function seriesFor(
  campaignId: number,
  store: DemoStore,
  hours = 24,
): { hour: string; sent: number; opens: number; clicks: number }[] {
  const now = new Date()
  const out: { hour: string; sent: number; opens: number; clicks: number }[] = []
  const campaignSends = store.sends.filter((s) => s.campaignId === campaignId)

  for (let i = hours - 1; i >= 0; i--) {
    const hourKey = new Date(now.getTime() - i * 3_600_000).toISOString().slice(0, 13)
    const sent = campaignSends.filter((s) => s.sentAt && s.sentAt.slice(0, 13) === hourKey).length
    const opens = campaignSends.filter((s) => s.openedAt && s.openedAt.slice(0, 13) === hourKey).length
    const clicks = campaignSends.filter((s) => s.clickedAt && s.clickedAt.slice(0, 13) === hourKey).length
    out.push({ hour: hourKey, sent, opens, clicks })
  }

  return out
}

export function dashboardSeries(
  store: DemoStore,
  hours = 24,
): { hour: string; sent: number; opens: number; clicks: number }[] {
  const now = new Date()
  const out: { hour: string; sent: number; opens: number; clicks: number }[] = []

  for (let i = hours - 1; i >= 0; i--) {
    const hourKey = new Date(now.getTime() - i * 3_600_000).toISOString().slice(0, 13)
    const sent = store.sends.filter((s) => s.status === 'sent' && s.sentAt && s.sentAt.slice(0, 13) === hourKey).length
    const opens = store.sends.filter((s) => s.openedAt && s.openedAt.slice(0, 13) === hourKey).length
    const clicks = store.sends.filter((s) => s.clickedAt && s.clickedAt.slice(0, 13) === hourKey).length
    out.push({ hour: hourKey, sent, opens, clicks })
  }

  return out
}

export function growthSeries(
  store: DemoStore,
  days = 14,
): { day: string; added: number; unsubscribed: number }[] {
  const now = new Date()
  const out: { day: string; added: number; unsubscribed: number }[] = []

  for (let i = days - 1; i >= 0; i--) {
    const dayKey = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    const added = store.contacts.filter((c) => c.createdAt && c.createdAt.slice(0, 10) === dayKey).length
    const unsubscribed = store.contacts.filter(
      (c) => c.unsubscribedAt && c.unsubscribedAt.slice(0, 10) === dayKey,
    ).length
    out.push({ day: dayKey, added, unsubscribed })
  }

  return out
}

export function audienceTotals(store: DemoStore) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  return {
    contacts: store.contacts.length,
    subscribed: store.contacts.filter((c) => c.status === 'subscribed').length,
    unsubscribed: store.contacts.filter((c) => c.status === 'unsubscribed').length,
    bounced: store.contacts.filter((c) => c.status === 'bounced').length,
    complained: store.contacts.filter((c) => c.status === 'complained').length,
    newThisWeek: store.contacts.filter((c) => c.createdAt >= weekAgo).length,
  }
}
