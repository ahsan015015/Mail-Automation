// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/client/App'
import { buildPreviewDocument } from '../src/client/lib/previewDocument'
import { bootWorkspace, type Workspace } from './helpers'

/**
 * The template preview renders into a sandboxed iframe. These tests cover the
 * document the frame boots from (`buildPreviewDocument`) and then drive the
 * real editor against a live `/api/templates/preview` response, so the merge
 * output is asserted after it has actually landed in the frame.
 */

describe('buildPreviewDocument', () => {
  it('wraps a fragment in a UTF-8 shell that forces links into a new tab', () => {
    const doc = buildPreviewDocument('<h1>Hello</h1>')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<meta charset="utf-8">')
    expect(doc).toContain('<base target="_blank">')
    expect(doc).toContain('<h1>Hello</h1>')
  })

  it('keeps non-ASCII copy byte-for-byte', () => {
    expect(buildPreviewDocument('<p>Café — naître ✓ 你好</p>')).toContain('<p>Café — naître ✓ 你好</p>')
  })

  it('boots a readable placeholder instead of an empty frame when there is no HTML', () => {
    const doc = buildPreviewDocument('   ')
    expect(doc).toContain('Nothing to preview yet')
    expect(doc).toContain('<base target="_blank">')
  })

  it('injects into a full document’s own head instead of double-wrapping it', () => {
    const source = '<!doctype html><html><head><style>p{color:red}</style></head><body><p>x</p></body></html>'
    const doc = buildPreviewDocument(source)
    expect(doc.match(/<html/gi)?.length).toBe(1)
    expect(doc).toContain('<head><meta charset="utf-8"><base target="_blank"><style>p{color:red}</style>')
    expect(doc).toContain('<p>x</p>')
  })

  it('supplies a head to a full document that has none', () => {
    const doc = buildPreviewDocument('<html><body><p>y</p></body></html>')
    expect(doc).toContain('<head><meta charset="utf-8"><base target="_blank"></head>')
    expect(doc.match(/<html/gi)?.length).toBe(1)
  })

  it('treats author markup literally, including $ replacement patterns', () => {
    const doc = buildPreviewDocument('<html><head data-note="$&"></head><body><p>y</p></body></html>')
    expect(doc).toContain('<head data-note="$&"><meta charset="utf-8">')
    expect(doc.match(/<head/gi)?.length).toBe(1)
  })
})

describe('template preview frame', () => {
  let workspace: Workspace
  const roots: Root[] = []

  beforeAll(async () => {
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
  }, 60_000)

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()
      act(() => root?.unmount())
    }
    document.body.innerHTML = ''
  })

  const settle = async (ms = 240): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    })
  }

  const click = (node: Element): void => {
    act(() => {
      node.dispatchEvent(new window.Event('click', { bubbles: true }))
    })
  }

  /** Opens the template editor and renders a preview; returns the frame + root. */
  async function renderPreview(): Promise<{ frame: HTMLIFrameElement; container: HTMLElement }> {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/templates']}>
          <App />
        </MemoryRouter>,
      )
    })
    await settle()
    await settle()

    const library = [...container.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('Welcome · day 0'))
    expect(library, 'the seeded template is listed').toBeTruthy()
    click(library!)
    await settle()

    const render = [...container.querySelectorAll('button')].find((node) => /Render with sample/.test(node.textContent ?? ''))
    expect(render, 'the editor offers "Render with sample"').toBeTruthy()
    click(render!)
    await settle(420)

    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame, 'the preview frame is mounted').toBeTruthy()
    return { frame: frame!, container }
  }

  /** The mode tabs render an icon before their label, so match trimmed text. */
  const tab = (container: HTMLElement, label: string): Element => {
    const node = [...container.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').trim() === label)
    expect(node, `the "${label}" tab is present`).toBeTruthy()
    return node!
  }

  it('boots the frame from the live preview endpoint, merged and link-safe', async () => {
    const { frame } = await renderPreview()
    const srcdoc = frame.getAttribute('srcdoc') ?? ''
    expect(srcdoc.length, 'the frame is given a document').toBeGreaterThan(0)

    // Real merge output from POST /api/templates/preview, not raw merge tags.
    // The sample contact resolves {{ company }} → Northwind and the preview
    // route sets {{ campaign }} → "Preview".
    expect(srcdoc).toContain('Northwind')
    expect(srcdoc).toContain('the Preview team')
    expect(srcdoc).not.toContain('{{ company')
    expect(srcdoc).not.toContain('{{ campaign')

    // The frame parsed that document, and its head makes links leave the frame
    // rather than navigating it away from the preview.
    const doc = frame.contentDocument
    expect(doc?.querySelector('meta[charset]') ?? null, 'charset is declared').not.toBeNull()
    expect(doc?.querySelector('base')?.getAttribute('target')).toBe('_blank')
    expect(doc?.body?.innerHTML).toContain('Northwind')
    expect(doc?.querySelector('a[href="https://example.com/docs/quickstart"]') ?? null).not.toBeNull()

    // Opaque origin, scripts off: the rendered email shares nothing with the app.
    const tokens = (frame.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean)
    expect(frame.hasAttribute('sandbox')).toBe(true)
    expect(tokens).not.toContain('allow-scripts')
    expect(tokens).not.toContain('allow-same-origin')
  })

  it('keeps the rendered preview across an HTML ⇄ Preview round trip', async () => {
    const { container } = await renderPreview()

    click(tab(container, 'HTML'))
    await settle(120)
    expect(container.querySelector('iframe'), 'the frame is torn down in edit mode').toBeNull()

    click(tab(container, 'Preview'))
    await settle(240)
    const remounted = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(remounted, 'the frame comes back').toBeTruthy()
    expect(remounted?.contentDocument?.body?.innerHTML).toContain('Northwind')
  })
})
