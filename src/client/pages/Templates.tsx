import { useMemo, useState } from 'react'
import type { TemplateDto } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync, useDebounced } from '../lib/hooks'
import { dateTime, number, relative } from '../lib/format'
import { ContentEditor, type EditorValue } from '../components/Editor'
import { Badge, Button, Card, CardHead, Confirm, EmptyState, ErrorNote, IconButton, Input, Modal, PageHeader, Skeleton, Field, Textarea } from '../components/ui'
import { IconCode, IconCopy, IconPlus, IconRefresh, IconTemplate, IconTrash } from '../components/Icons'

const STARTER_HTML = `<h1 style="margin:0 0 12px;font-size:22px">Hi {{ first_name | friend }},</h1>
<p style="margin:0 0 16px;color:#334155;line-height:1.6">
  Write your message here. Merge tags like <code>{{ email }}</code> are replaced per contact at send time.
</p>
<p style="margin:0"><a href="https://example.com" style="color:#4f46e5;font-weight:600">Read the update →</a></p>`

export function TemplatesPage() {
  const { toast, live } = useApp()
  usePageTitle('Templates')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<(EditorValue & { name: string }) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TemplateDto | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [rawHtml, setRawHtml] = useState('')
  const [importName, setImportName] = useState('Imported template')

  const query = useDebounced(search, 250)
  const { data, error, loading, reload } = useAsync(() => api.templates.list(query), [query, live.revision])
  const items = data?.items ?? []
  const selected = useMemo(() => items.find((entry) => entry.id === selectedId) ?? null, [items, selectedId])

  const current = draft && selected ? { ...selected, ...draft } : selected
  const editorValue: EditorValue & { name: string } = current
    ? { name: current.name, subject: current.subject, preheader: current.preheader, html: current.html, text: current.text }
    : { name: '', subject: '', preheader: '', html: '', text: '' }

  const pick = (template: TemplateDto): void => {
    setSelectedId(template.id)
    setDraft(null)
    setDirty(false)
  }

  const save = async (): Promise<void> => {
    if (!selected || !current) return
    setBusy('save')
    try {
      await api.templates.update(selected.id, { name: current.name, subject: current.subject, preheader: current.preheader, html: current.html, text: current.text })
      toast('success', 'Template saved')
      setDraft(null)
      setDirty(false)
      reload()
    } catch (cause) {
      toast('error', 'Could not save', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const create = async (name: string, html?: string): Promise<void> => {
    setBusy('create')
    try {
      const created = await api.templates.create({ name, subject: '', preheader: '', html: html ?? STARTER_HTML, text: '' })
      reload()
      pick(created)
      setCreateOpen(false)
      setImportOpen(false)
      setRawHtml('')
      toast('success', 'Template created')
    } catch (cause) {
      toast('error', 'Could not create the template', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Reusable subject lines and bodies. Campaign steps copy from them, so a fix here never rewrites a running campaign by accident."
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreateOpen(true)}>
              New template
            </Button>
          </>
        }
      />

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="flex max-h-[70vh] flex-col">
          <CardHead title="Library" subtitle={`${number(items.length)} template(s)`} icon={<IconTemplate size={16} />} />
          <div className="border-b border-slate-200/70 p-2.5">
            <Input className="!py-1.5 text-[12.5px]" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          {loading && !data ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14" />
              ))}
            </div>
          ) : !items.length ? (
            <EmptyState icon={<IconTemplate size={18} />} title="No templates" body="Create one from scratch, or paste your existing HTML." action={<Button size="sm" onClick={() => setCreateOpen(true)}>New template</Button>} />
          ) : (
            <ul className="scroll-thin min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {items.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => pick(template)}
                    className={`w-full px-3.5 py-2.5 text-left transition ${template.id === selectedId ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <p className="truncate text-[13.5px] font-medium text-slate-900">{template.name}</p>
                    <p className="mt-0.5 truncate text-[12px] text-slate-500">{template.subject || 'No subject'}</p>
                    <p className="mt-1 text-[11px] text-slate-400">edited {relative(template.updatedAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {!current ? (
            <EmptyState
              icon={<IconCode size={18} />}
              title="Pick a template"
              body="Choose one on the left to edit its subject, preheader and HTML body."
            />
          ) : (
            <>
              <CardHead
                title={
                  <span className="flex items-center gap-2">
                    {current.name}
                    {dirty ? <Badge tone="amber">unsaved</Badge> : null}
                  </span>
                }
                subtitle={`created ${dateTime(current.createdAt)}`}
                icon={<IconTemplate size={16} />}
                actions={
                  <>
                    <Button size="sm" variant="ghost" icon={<IconCopy size={13} />} loading={busy === 'duplicate'} onClick={async () => { setBusy('duplicate'); try { const copy = await api.templates.duplicate(current.id); toast('success', 'Duplicated'); await reload(); pick(copy) } catch (cause) { toast('error', 'Duplicate failed', cause instanceof Error ? cause.message : undefined) } finally { setBusy(null) } }}>
                      Duplicate
                    </Button>
                    <IconButton label="Delete template" onClick={() => setConfirmDelete(current)}>
                      <IconTrash size={14} />
                    </IconButton>
                    <Button size="sm" variant="primary" loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
                      Save
                    </Button>
                  </>
                }
              />
              <div className="card-pad">
                <Field label="Template name" className="mb-3">
                  <Input
                    value={editorValue.name ?? ''}
                    onChange={(event) => {
                      setDirty(true)
                      setDraft({ ...(draft ?? editorValue), name: event.target.value })
                    }}
                  />
                </Field>
                <ContentEditor
                  value={editorValue}
                  onChange={(patch) => {
                    setDirty(true)
                    setDraft({ ...(draft ?? editorValue), ...patch })
                  }}
                  hideText={false}
                  testTarget={{ kind: 'template', id: current.id }}
                  onSave={() => void save()}
                  saveLabel="Save template"
                />
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New template"
        subtitle="Start blank, from the built-in skeleton, or paste your own HTML."
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => void create('Untitled template')}>
              Blank
            </Button>
            <Button variant="primary" loading={busy === 'create'} onClick={() => void create('Starter template')}>
              Use skeleton
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-slate-500">
          A template holds a subject, a preheader and an HTML body. Merge tags such as <code>{'{{first_name}}'}</code> stay untouched until the message is rendered for a contact.
        </p>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
            Paste HTML instead
          </Button>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import HTML"
        width="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!rawHtml.trim()} onClick={() => void create(importName.trim() || 'Imported template', rawHtml)}>
              Create template
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={importName} onChange={(event) => setImportName(event.target.value)} />
          </Field>
          <Textarea rows={12} className="font-mono !text-[12px]" value={rawHtml} onChange={(event) => setRawHtml(event.target.value)} placeholder="<h1>Hello</h1>" />
          <p className="hint">Tags, scripts and inline event handlers are stripped on save — only safe email HTML survives.</p>
        </div>
      </Modal>

      <Confirm
        open={Boolean(confirmDelete)}
        title="Delete this template?"
        body="Campaign steps keep the content they already copied, so nothing breaks mid-send."
        confirmLabel="Delete template"
        danger
        busy={busy !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return
          setBusy('delete')
          try {
            await api.templates.remove(confirmDelete.id)
            if (selectedId === confirmDelete.id) setSelectedId(null)
            setConfirmDelete(null)
            toast('success', 'Template deleted')
            reload()
          } catch (cause) {
            toast('error', 'Delete failed', cause instanceof Error ? cause.message : undefined)
          } finally {
            setBusy(null)
          }
        }}
      />
    </div>
  )
}

