import type {
  CampaignDto,
  CampaignStats,
  ContactDto,
  DashboardDto,
  EventDto,
  FunnelPoint,
  ImportResult,
  ListDto,
  MailboxMessageDto,
  Paged,
  Segment,
  SendDto,
  StepDto,
  TagDto,
  TemplateDto,
  UserDto,
  WorkspaceSettings,
} from '@shared/types'

export interface ApiError extends Error {
  status: number
  issues?: { path: string; message: string }[]
}

export function apiError(message: string, status: number, issues?: ApiError['issues']): ApiError {
  const error = new Error(message) as ApiError
  error.status = status
  error.issues = issues
  return error
}

const DEMO = import.meta.env.VITE_DEMO === '1'
export const isDemoBuild = DEMO

async function request<T>(route: string, init: RequestInit = {}): Promise<T> {
  if (DEMO) {
    const { handleDemoRequest } = await import('./demo')
    return handleDemoRequest<T>(route, init)
  }
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  let response: Response
  try {
    response = await fetch(route.startsWith('/') ? route : `/api${route}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
  } catch (cause) {
    throw apiError(`Cannot reach the server (${(cause as Error)?.message ?? 'network error'})`, 0)
  }
  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      /* csv / html */
    }
  }
  if (!response.ok) {
    const payload = body as { error?: { message?: string; issues?: ApiError['issues'] } } | undefined
    throw apiError(payload?.error?.message ?? `${response.status} ${response.statusText}`, response.status, payload?.error?.issues)
  }
  return body as T
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })
export const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const out = search.toString()
  return out ? `?${out}` : ''
}

export interface Bootstrap {
  user: UserDto | null
  needsSetup: boolean
  settings?: WorkspaceSettings
  app?: { name: string; version: string; env: string }
}

export interface ContactQuery {
  q?: string
  listId?: number
  tagId?: number
  status?: string
  sort?: string
  page?: number
  perPage?: number
}

export const api = {
  request,
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  auth: {
    login: (email: string, password: string) => request<{ user: UserDto }>('/api/auth/login', json('POST', { email, password })),
    setup: (input: { email: string; password: string; name?: string }) => request<{ user: UserDto }>('/api/auth/setup', json('POST', input)),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', json('POST')),
    me: () => request<{ user: UserDto | null; needsSetup: boolean; workspaceName: string; demoMode: boolean }>('/api/auth/me'),
  },
  lists: {
    list: (includeArchived = false) => request<{ items: ListDto[]; totals: { contacts: number; subscribed: number; unsubscribed: number; bounced: number; complained: number; newThisWeek: number } }>(`/api/lists${qs({ includeArchived: includeArchived ? 1 : undefined })}`),
    create: (input: { name: string; description?: string }) => request<ListDto>('/api/lists', json('POST', input)),
    update: (id: number, patch: Partial<ListDto>) => request<ListDto>(`/api/lists/${id}`, json('PATCH', patch)),
    remove: (id: number) => request<{ ok: boolean }>(`/api/lists/${id}`, json('DELETE')),
    contacts: (id: number, query: ContactQuery = {}) => request<Paged<ContactDto>>(`/api/lists/${id}/contacts${qs({ ...query })}`),
    regenerateToken: (id: number) => request<ListDto>(`/api/lists/${id}/regenerate-token`, json('POST')),
    addMembers: (id: number, contactIds: number[]) => request<{ ok: boolean; added: number }>(`/api/lists/${id}/members`, json('POST', { contactIds })),
    removeMember: (id: number, contactId: number) => request<{ ok: boolean }>(`/api/lists/${id}/members/${contactId}`, json('DELETE')),
  },
  tags: {
    list: () => request<{ items: TagDto[] }>('/api/tags'),
    create: (name: string, color?: string) => request<TagDto>('/api/tags', json('POST', { name, color })),
    remove: (id: number) => request<{ ok: boolean }>(`/api/tags/${id}`, json('DELETE')),
  },
  contacts: {
    list: (query: ContactQuery = {}) => request<Paged<ContactDto>>(`/api/contacts${qs({ ...query })}`),
    get: (id: number) => request<ContactDto>(`/api/contacts/${id}`),
    create: (input: Record<string, unknown>) => request<ContactDto>('/api/contacts', json('POST', input)),
    update: (id: number, patch: Record<string, unknown>) => request<ContactDto>(`/api/contacts/${id}`, json('PATCH', patch)),
    remove: (id: number) => request<{ ok: boolean }>(`/api/contacts/${id}`, json('DELETE')),
    removeMany: (ids: number[]) => request<{ ok: boolean; deleted: number }>('/api/contacts/bulk-delete', json('POST', { ids })),
    unsubscribe: (id: number) => request<ContactDto>(`/api/contacts/${id}/unsubscribe`, json('POST')),
    resubscribe: (id: number) => request<ContactDto>(`/api/contacts/${id}/resubscribe`, json('POST')),
    events: (id: number) => request<{ items: EventDto[] }>(`/api/contacts/${id}/events`),
    fields: () => request<{ items: string[] }>('/api/contacts/fields'),
    import: (input: {
      csv: string
      listId?: number
      duplicatePolicy?: 'skip' | 'update'
      defaultStatus?: string
      tags?: string[]
      sendMail?: boolean
    }) =>
      request<ImportResult>('/api/contacts/import', json('POST', input)),
    exportUrl: (query: ContactQuery = {}) => `/api/contacts/export${qs({ ...query })}`,
  },
  templates: {
    list: (q = '') => request<Paged<TemplateDto>>(`/api/templates${qs({ q })}`),
    get: (id: number) => request<TemplateDto>(`/api/templates/${id}`),
    create: (input: Record<string, unknown>) => request<TemplateDto>('/api/templates', json('POST', input)),
    update: (id: number, patch: Record<string, unknown>) => request<TemplateDto>(`/api/templates/${id}`, json('PATCH', patch)),
    remove: (id: number) => request<{ ok: boolean }>(`/api/templates/${id}`, json('DELETE')),
    duplicate: (id: number) => request<TemplateDto>(`/api/templates/${id}/duplicate`, json('POST')),
    preview: (input: { subject: string; preheader?: string; html: string; text?: string; sample?: Record<string, string> }) =>
      request<{ subject: string; preheader: string; html: string; text: string; issues: string[] }>('/api/templates/preview', json('POST', input)),
    test: (id: number, email: string) => request<{ ok: boolean; transport: string; mailboxId: number | null }>(`/api/templates/${id}/test`, json('POST', { email })),
  },
  campaigns: {
    list: (query: { status?: string; q?: string; page?: number; perPage?: number } = {}) => request<Paged<CampaignDto>>(`/api/campaigns${qs({ ...query })}`),
    get: (id: number) => request<CampaignDto>(`/api/campaigns/${id}`),
    create: (input: Record<string, unknown>) => request<CampaignDto>('/api/campaigns', json('POST', input)),
    update: (id: number, patch: Record<string, unknown>) => request<CampaignDto>(`/api/campaigns/${id}`, json('PATCH', patch)),
    remove: (id: number) => request<{ ok: boolean }>(`/api/campaigns/${id}`, json('DELETE')),
    duplicate: (id: number) => request<CampaignDto>(`/api/campaigns/${id}/duplicate`, json('POST')),
    validate: (id: number) => request<{ ready: boolean; problems: string[] }>(`/api/campaigns/${id}/validate`, json('POST')),
    start: (id: number, at?: string) => request<CampaignDto>(`/api/campaigns/${id}/start`, json('POST', at ? { at } : {})),
    pause: (id: number) => request<CampaignDto>(`/api/campaigns/${id}/pause`, json('POST')),
    resume: (id: number) => request<CampaignDto>(`/api/campaigns/${id}/resume`, json('POST')),
    cancel: (id: number) => request<CampaignDto>(`/api/campaigns/${id}/cancel`, json('POST')),
    retryFailed: (id: number) => request<{ ok: boolean; retried: number; campaign: CampaignDto }>(`/api/campaigns/${id}/retry-failed`, json('POST')),
    sendTest: (id: number, email: string, stepId?: number) => request<{ ok: boolean; transport: string; subject: string }>(`/api/campaigns/${id}/send-test`, json('POST', { email, stepId })),
    stats: (id: number) => request<{ stats: CampaignStats; funnel: FunnelPoint[] }>(`/api/campaigns/${id}/stats`),
    series: (id: number, hours = 24) => request<{ points: { hour: string; sent: number; opens: number; clicks: number }[] }>(`/api/campaigns/${id}/series${qs({ hours })}`),
    sends: (id: number, query: { status?: string; stepId?: number; q?: string; page?: number; perPage?: number } = {}) =>
      request<Paged<SendDto>>(`/api/campaigns/${id}/sends${qs({ ...query })}`),
    events: (id: number) => request<{ items: EventDto[] }>(`/api/campaigns/${id}/events`),
    estimate: (segment: Segment) => request<{ recipients: number; sample: { id: number; email: string; name: string }[] }>('/api/campaigns/estimate', json('POST', { segment })),
    addStep: (id: number, input: Partial<StepDto>) => request<StepDto>(`/api/campaigns/${id}/steps`, json('POST', input)),
    updateStep: (id: number, stepId: number, patch: Partial<StepDto>) => request<StepDto>(`/api/campaigns/${id}/steps/${stepId}`, json('PATCH', patch)),
    removeStep: (id: number, stepId: number) => request<{ ok: boolean }>(`/api/campaigns/${id}/steps/${stepId}`, json('DELETE')),
    moveStep: (id: number, stepId: number, direction: 'up' | 'down') => request<CampaignDto>(`/api/campaigns/${id}/steps/${stepId}/move`, json('POST', { direction })),
  },
  settings: {
    get: () => request<WorkspaceSettings>('/api/settings'),
    update: (patch: Record<string, unknown>) => request<WorkspaceSettings>('/api/settings', json('PUT', patch)),
    verify: () => request<{ ok: boolean; transport: string; message: string }>('/api/settings/smtp/test', json('POST')),
  },
  stats: {
    dashboard: () => request<DashboardDto>('/api/stats/dashboard'),
    growth: (days = 14) => request<{ points: { day: string; added: number; unsubscribed: number }[] }>(`/api/stats/growth${qs({ days })}`),
  },
  activity: (limit = 40) => request<{ items: EventDto[] }>(`/api/activity${qs({ limit })}`),
  mailbox: {
    list: (query: { q?: string; campaignId?: number; page?: number; perPage?: number } = {}) => request<Paged<MailboxMessageDto>>(`/api/mailbox${qs({ ...query })}`),
    get: (id: number) => request<MailboxMessageDto>(`/api/mailbox/${id}`),
    simulateOpen: (id: number) => request<{ ok: boolean; message: MailboxMessageDto; stats: CampaignStats | null }>(`/api/mailbox/${id}/simulate-open`, json('POST')),
    clear: () => request<{ ok: boolean; removed: number }>('/api/mailbox', json('DELETE')),
    rawUrl: (id: number) => `/api/mailbox/${id}/raw`,
  },
  engine: {
    status: () =>
      request<{
        running: boolean
        tickMs: number
        queueDepth: number
        transport: 'smtp' | 'memory'
        lastTickAt: string | null
        tickDurationMs: number | null
        lifetime: { sent: number; failed: number; skipped: number }
        limits: { dailyCap: number; ratePerMinute: number; maxAttempts: number }
      }>('/api/engine'),
    tick: () => request<{ processed: number; sent: number; failed: number; skipped: number }>('/api/engine/tick', json('POST')),
    drain: (maxRounds = 40) => request<{ processed: number; sent: number; failed: number; skipped: number }>('/api/engine/drain', json('POST', { maxRounds })),
  },
}
