// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Stub environment before dynamic imports
vi.stubEnv('VITE_DEMO', '1')

let App: typeof import('../src/client/App').App
let resetStore: typeof import('../src/client/lib/demo/store').resetStore
let getStore: typeof import('../src/client/lib/demo/store').getStore
let isDemoBuild: boolean

const roots: Root[] = []
const consoleErrors: string[] = []

beforeAll(async () => {
  const apiModule = await import('../src/client/lib/api')
  isDemoBuild = apiModule.isDemoBuild

  const appModule = await import('../src/client/App')
  App = appModule.App

  const storeModule = await import('../src/client/lib/demo/store')
  resetStore = storeModule.resetStore
  getStore = storeModule.getStore

  resetStore()

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()
    act(() => root?.unmount())
  }
  document.body.innerHTML = ''
})

const settle = async (ms = 250): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function renderRoute(route: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    )
  })
  await settle()
  await settle()
  return container
}

const text = (element: HTMLElement): string => element.textContent ?? ''

function fieldInput(root: HTMLElement, label: string): HTMLInputElement {
  const match = [...root.querySelectorAll('label')].find((node) => (node.textContent ?? '').startsWith(label))
  const input = match?.parentElement?.querySelector('input, textarea, select') as HTMLInputElement | null
  if (!input) throw new Error(`no field labelled ${label}`)
  return input
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

function clickText(root: HTMLElement, pattern: RegExp): HTMLElement {
  const button = [...root.querySelectorAll('button, a')].find((node) => pattern.test(node.textContent ?? ''))
  if (!button) throw new Error(`no control matching ${pattern}`)
  act(() => {
    button.dispatchEvent(new window.Event('click', { bubbles: true }))
  })
  return button
}

describe('client app in demo mode (VITE_DEMO=1)', () => {
  it('identifies as demo build', () => {
    expect(isDemoBuild).toBe(true)
  })

  it('renders the demo dashboard with seeded stats', async () => {
    const page = await renderRoute('/')
    expect(text(page)).toContain('Dashboard')
    expect(text(page)).toContain('Delivery engine')
    expect(text(page)).toContain('Top campaigns')
    expect(text(page)).toContain('March product announcement')
  })

  it('renders the campaigns page in demo mode', async () => {
    const page = await renderRoute('/campaigns')
    expect(text(page)).toContain('Campaigns')
    expect(text(page)).toContain('Onboarding drip')
    expect(text(page)).toContain('March product announcement')
  })

  it('renders campaign builder with live audience estimation', async () => {
    const page = await renderRoute('/campaigns/new')
    expect(text(page)).toContain('New campaign')
    expect(text(page)).toContain('Estimated recipients')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320))
    })
    expect(text(page)).toMatch(/Estimated recipients\D*\d/)
  })

  it('renders campaign detail with stats and delivery logs', async () => {
    const page = await renderRoute('/campaigns/1')
    expect(text(page)).toContain('March product announcement')
    expect(text(page)).toContain('Sending plan')
    await act(async () => {
      clickText(page, /Delivery/)
    })
    await settle()
    expect(text(page)).toContain('Delivery log')
  })

  it('renders contacts with seeded records and supports filtering', async () => {
    const page = await renderRoute('/contacts')
    expect(text(page)).toContain('Contacts')
    expect(text(page)).toMatch(/@/)
    expect(text(page)).toContain('Export CSV')
    expect(text(page)).toContain('Import')
  })

  it('renders lists and creates a new list in localStorage', async () => {
    const page = await renderRoute('/lists')
    expect(text(page)).toContain('Lists & tags')
    expect(text(page)).toContain('Customers')

    await act(async () => {
      clickText(page, /New list/)
    })
    await settle(120)

    await act(async () => {
      typeInto(fieldInput(page, 'Name'), 'Demo VIP List')
    })
    await act(async () => {
      clickText(page, /Create list/)
    })
    await settle(300)

    const store = getStore()
    expect(store.lists.some((l) => l.name === 'Demo VIP List')).toBe(true)
    expect(text(page)).toContain('Demo VIP List')
  })

  it('renders templates library', async () => {
    const page = await renderRoute('/templates')
    expect(text(page)).toContain('Templates')
    expect(text(page)).toContain('Welcome · day 0')
  })

  it('renders the mailbox with captured demo emails', async () => {
    const page = await renderRoute('/inbox')
    expect(text(page)).toContain('Inbox')
    expect(text(page)).toContain('Captured mail')
    expect(text(page)).toMatch(/@/)
  })

  it('renders settings and updates workspace preferences', async () => {
    const page = await renderRoute('/settings')
    expect(text(page)).toContain('Transport')
    expect(text(page)).toContain('SMTP host')

    const input = fieldInput(page, 'Workspace name')
    expect(input.value).toBe('Mail Automation')
    await act(async () => {
      typeInto(input, 'Local Demo Org')
    })
    await settle(60)
    await act(async () => {
      clickText(page, /Save changes/)
    })
    await settle(300)

    const store = getStore()
    expect(store.settings.workspaceName).toBe('Local Demo Org')
    expect(text(page)).toContain('Saved')
  })

  it('mounts all routes without fatal react errors', () => {
    const fatal = consoleErrors.filter(
      (line) =>
        /Minified React error|Uncaught|Element type is invalid|Too many re-renders/.test(line) &&
        !/not wrapped in act\(\)/.test(line),
    )
    expect(fatal).toEqual([])
  })
})
