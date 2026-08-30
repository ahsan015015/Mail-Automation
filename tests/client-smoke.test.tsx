// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/client/App'
import { bootWorkspace, type Workspace } from './helpers'

/**
 * Renders the real SPA against a booted workspace (temp SQLite + memory
 * transport) so every route is exercised with live API responses. This is a
 * smoke test: it proves the client mounts, wires the endpoints and paints.
 */
let workspace: Workspace
const roots: Root[] = []
const consoleErrors: string[] = []

beforeAll(async () => {
  // Pretend the browser lives on the test server, so the client's relative
  // `/api/...` fetches are same-origin and happy-dom's cookie jar carries the session.
  workspace = await bootWorkspace(true)
  const { seedDemoData } = await import('../src/server/db/seed.js')
  seedDemoData()
  await (window as unknown as { happyDOM: { setURL: (url: string) => Promise<void> } }).happyDOM.setURL(`${workspace.base}/`)
  await workspace.login('admin@test.dev', 'test-password-123')

  // happy-dom ships no EventSource; the live stream is optional for rendering
  if (typeof (globalThis as Record<string, unknown>).EventSource === 'undefined') {
    class FakeStream {
      onmessage: ((event: unknown) => void) | null = null
      addEventListener(): void {}
      close(): void {}
    }
    ;(globalThis as Record<string, unknown>).EventSource = FakeStream
  }
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '))
  })
}, 60_000)

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()
    act(() => root?.unmount())
  }
  document.body.innerHTML = ''
})

const settle = async (ms = 220): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function render(route: string): Promise<HTMLElement> {
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

/** The label of a <Field> is the only stable handle on its control. */
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

describe('client routes', () => {
  it('renders the dashboard with seeded numbers', async () => {
    const page = await render('/')
    expect(text(page)).toContain('Dashboard')
    expect(text(page)).toContain('Delivery engine')
    expect(text(page)).toContain('Top campaigns')
    expect(text(page)).toContain('March product announcement')
  })

  it('renders the campaign list', async () => {
    const page = await render('/campaigns')
    expect(text(page)).toContain('Campaigns')
    expect(text(page)).toContain('Onboarding drip')
    expect(text(page)).toContain('New campaign')
  })

  it('renders the campaign builder with an audience estimate', async () => {
    const page = await render('/campaigns/new')
    expect(text(page)).toContain('New campaign')
    expect(text(page)).toContain('Estimated recipients')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320))
    })
    expect(text(page)).toMatch(/Estimated recipients\D*\d/)
  })

  it('renders a campaign detail page with stats and delivery log', async () => {
    const page = await render('/campaigns/1')
    expect(text(page)).toContain('March product announcement')
    expect(text(page)).toContain('Sending plan')
    await act(async () => {
      clickText(page, /Delivery/)
    })
    await settle()
    expect(text(page)).toContain('Delivery log')
  })

  it('renders contacts with rows from the seeded audience', async () => {
    const page = await render('/contacts')
    expect(text(page)).toContain('Contacts')
    expect(text(page)).toMatch(/@/)
    expect(text(page)).toContain('Export CSV')
    expect(text(page)).toContain('Import')
  })

  it('renders lists and tags', async () => {
    const page = await render('/lists')
    expect(text(page)).toContain('Lists & tags')
    expect(text(page)).toContain('Public subscribe page')
  })

  it('renders the template library and editor', async () => {
    const page = await render('/templates')
    expect(text(page)).toContain('Templates')
    expect(text(page)).toContain('Library')
  })

  it('renders the captured mailbox', async () => {
    const page = await render('/inbox')
    expect(text(page)).toContain('Inbox')
    expect(text(page)).toContain('Captured mail')
  })

  it('renders settings and saves a change', async () => {
    const page = await render('/settings')
    expect(text(page)).toContain('Transport')
    expect(text(page)).toContain('SMTP host')
    expect(text(page)).toContain('Tracking defaults')

    const input = fieldInput(page, 'Workspace name')
    expect(input.value).toBe('Mail Automation')
    await act(async () => {
      typeInto(input, 'Mail Automation ✔')
    })
    await settle(60)
    await act(async () => {
      clickText(page, /Save changes/)
    })
    await settle(400)
    const settings = await workspace.api(`/api/settings?checked=${Date.now()}`)
    expect(String(settings.body.workspaceName)).toContain('✔')
    expect(text(page)).toContain('Saved')
  })

  it('creates a list through the modal', async () => {
    const page = await render('/lists')
    await act(async () => {
      clickText(page, /New list/)
    })
    await settle(120)
    await act(async () => {
      typeInto(fieldInput(page, 'Name'), 'Smoke test list')
    })
    await act(async () => {
      clickText(page, /Create list/)
    })
    await settle(400)
    const lists = await workspace.api(`/api/lists?checked=${Date.now()}`)
    expect(JSON.stringify(lists.body)).toContain('Smoke test list')
    expect(text(page)).toContain('Smoke test list')
  })

  it('never logged a React error while mounting every route', () => {
    const fatal = consoleErrors.filter((line) => /Minified React error|Uncaught|Element type is invalid|Too many re-renders|not wrapped in act/.test(line) && !/not wrapped in act\(\)/.test(line))
    expect(fatal).toEqual([])
  })
})
