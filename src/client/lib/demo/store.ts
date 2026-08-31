import type {
  CampaignDto,
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
import { createSeedStore } from './seed'

export interface DemoStore {
  user: UserDto | null
  settings: WorkspaceSettings
  lists: ListDto[]
  tags: TagDto[]
  contacts: ContactDto[]
  templates: TemplateDto[]
  campaigns: CampaignDto[]
  sends: SendDto[]
  events: EventDto[]
  mailbox: MailboxMessageDto[]
  engine: {
    running: boolean
    lastTickAt: string | null
    tickDurationMs: number | null
    lifetime: { sent: number; failed: number; skipped: number }
  }
}

const STORAGE_KEY = 'mail_automation_demo_db'

export function clone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj
  return JSON.parse(JSON.stringify(obj)) as T
}

let memoryFallback: DemoStore | null = null

export function getStore(): DemoStore {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw) as DemoStore
      if (parsed && Array.isArray(parsed.contacts) && Array.isArray(parsed.campaigns)) {
        return parsed
      }
    }
  } catch {
    /* localStorage disabled or quota exceeded */
  }

  if (memoryFallback) return memoryFallback

  const seeded = createSeedStore()
  saveStore(seeded)
  return seeded
}

export function saveStore(store: DemoStore): void {
  memoryFallback = store
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    }
  } catch {
    /* private browsing / quota exceeded */
  }
}

export function resetStore(): DemoStore {
  const seeded = createSeedStore()
  saveStore(seeded)
  return seeded
}
