import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ContactDto, ListDto, Paged } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { number, plural, relative } from '../lib/format'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  Confirm,
  ContactBadge,
  CopyButton,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Kpi,
  Loading,
  Modal,
  PageHeader,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui'
import { IconList, IconPlus, IconRefresh, IconTag, IconTrash, IconUsers } from '../components/Icons'

const TAG_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b']

export function ListsPage() {
  const { toast, live } = useApp()
  usePageTitle('Lists')
  const [tab, setTab] = useState<'lists' | 'tags'>('lists')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<ListDto | 'new' | null>(null)
  const [membersFor, setMembersFor] = useState<ListDto | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ListDto | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, error, loading, reload } = useAsync(() => api.lists.list(showArchived), [showArchived, live.revision])
  const tags = useAsync(() => api.tags.list(), [live.revision])

  const run = async (label: string, action: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      toast('success', message)
      reload()
      tags.reload()
    } catch (cause) {
      toast('error', 'That did not work', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
      void label
    }
  }

  const totals = data?.totals
  const lists = (data?.items ?? []).filter((list) => showArchived || !list.archived)

  return (
    <div>
      <PageHeader
        title="Lists & tags"
        subtitle="Lists are your legal audience boundary; tags are free-form labels you can filter on."
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditing('new')}>
              New list
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Lists" value={number(lists.length)} sub={totals ? `${number(totals.contacts)} memberships` : undefined} icon={<IconList size={14} />} />
        <Kpi label="Subscribed" value={number(totals?.subscribed)} sub={`${number(totals?.newThisWeek)} new this week`} icon={<IconUsers size={14} />} tone="emerald" />
        <Kpi label="Unsubscribed" value={number(totals?.unsubscribed)} icon={<IconUsers size={14} />} tone="slate" />
        <Kpi label="Bounced / complained" value={number((totals?.bounced ?? 0) + (totals?.complained ?? 0))} sub="automatically suppressed" icon={<IconTag size={14} />} tone="rose" />
      </div>

      <Tabs
        tabs={[
          { value: 'lists', label: 'Lists', badge: <Badge tone="slate">{number(lists.length)}</Badge> },
          { value: 'tags', label: 'Tags', badge: <Badge tone="slate">{number(tags.data?.items.length ?? 0)}</Badge> },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error ? <div className="mt-4"><ErrorNote error={error} onRetry={reload} /></div> : null}

      {tab === 'lists' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Toggle label="Show archived" checked={showArchived} onChange={setShowArchived} />
          </div>
          {!lists.length ? (
            <Card>
              <EmptyState
                icon={<IconList size={18} />}
                title="No lists yet"
                body="Everyone you send to should live on at least one list — that is what the unsubscribe link and the sending window are scoped to."
                action={
                  <Button size="sm" variant="primary" icon={<IconPlus size={13} />} onClick={() => setEditing('new')}>
                    Create your first list
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {lists.map((list) => (
                <Card key={list.id} className="animate-rise">
                  <CardHead
                    title={
                      <span className="flex items-center gap-2">
                        {list.name}
                        {list.archived ? <Badge tone="slate">archived</Badge> : null}
                      </span>
                    }
                    subtitle={list.description || 'No description'}
                    icon={<IconList size={16} />}
                    actions={
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(list)}>
                          Edit
                        </Button>
                        <IconButton label="Delete list" onClick={() => setConfirmDelete(list)}>
                          <IconTrash size={14} />
                        </IconButton>
                      </>
                    }
                  />
                  <div className="card-pad">
                    <div className="flex flex-wrap gap-2 text-[12.5px]">
                      <button type="button" onClick={() => setMembersFor(list)} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-left hover:bg-slate-100">
                        <span className="block text-[11px] text-slate-500">Subscribed</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{number(list.subscribedCount)}</span>
                      </button>
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <span className="block text-[11px] text-slate-500">Everyone</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{number(list.contactCount)}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <span className="block text-[11px] text-slate-500">Unsubscribed</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{number(list.unsubscribeCount)}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <span className="block text-[11px] text-slate-500">Created</span>
                        <span className="font-semibold text-slate-800">{relative(list.createdAt)}</span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-200/70 px-3 py-2">
                      <p className="text-[11.5px] text-slate-500">Public subscribe page</p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600">/t/lists/{list.subscribeToken}</code>
                        <CopyButton value={`${window.location.origin}/t/lists/${list.subscribeToken}`} label="Copy" />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Link to="/contacts" className="btn btn-secondary btn-sm">
                        Manage members
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy}
                        onClick={() => void run('archive', () => api.lists.update(list.id, { archived: !list.archived }), list.archived ? 'List restored' : 'List archived')}
                      >
                        {list.archived ? 'Restore' : 'Archive'}
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy} onClick={() => void run('token', () => api.lists.regenerateToken(list.id), 'New subscribe token issued')}>
                        Rotate token
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <TagsPanel
          items={tags.data?.items ?? []}
          busy={busy}
          onCreate={(name, color) => void run('tag', () => api.tags.create(name, color), 'Tag created')}
          onRemove={(id) => void run('tag-delete', () => api.tags.remove(id), 'Tag removed')}
        />
      )}

      <ListEditor
        list={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
      />

      <MembersModal list={membersFor} onClose={() => setMembersFor(null)} onChanged={reload} />

      <Confirm
        open={Boolean(confirmDelete)}
        title="Delete this list?"
        body="Contacts are not deleted — only the membership rows. Campaigns that targeted this list will simply match fewer people."
        confirmLabel="Delete list"
        danger
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void run('delete', () => api.lists.remove(confirmDelete.id), 'List deleted')
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

function TagsPanel({ items, busy, onCreate, onRemove }: { items: { id: number; name: string; color: string; contactCount: number }[]; busy: boolean; onCreate: (name: string, color: string) => void; onRemove: (id: number) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(TAG_COLORS[0])

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHead title="Existing tags" subtitle="tags are shared across every list" icon={<IconTag size={16} />} />
        <div className="card-pad">
          {!items.length ? (
            <p className="text-[13px] text-slate-500">No tags yet. Add one on the right — tags make it easy to build segments like “trial + not converted”.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {items.map((tag) => (
                <li key={tag.id}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pr-1 pl-2.5 text-[12.5px] font-medium text-slate-700">
                    <span className="size-2 rounded-full" style={{ background: tag.color }} />
                    {tag.name}
                    <span className="text-[11px] text-slate-400 tabular-nums">{number(tag.contactCount)}</span>
                    <IconButton label={`Delete ${tag.name}`} onClick={() => onRemove(tag.id)} disabled={busy}>
                      <IconTrash size={12} />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="New tag" />
        <div className="card-pad space-y-3">
          <Field label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="power-user" />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {TAG_COLORS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setColor(candidate)}
                  className={`size-7 rounded-full ring-2 ring-offset-2 transition ${color === candidate ? 'ring-slate-400' : 'ring-transparent'}`}
                  style={{ background: candidate }}
                  aria-label={`Use ${candidate}`}
                />
              ))}
            </div>
          </Field>
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            loading={busy}
            onClick={() => {
              onCreate(name.trim(), color)
              setName('')
            }}
          >
            Create tag
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ListEditor({ list, onClose, onSaved }: { list: ListDto | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const isNew = list === 'new'
  const current = list && list !== 'new' ? list : null
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [archived, setArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [readyFor, setReadyFor] = useState<ListDto | 'new' | null>(null)

  if (list && readyFor !== list) {
    setReadyFor(list)
    setName(current?.name ?? '')
    setDescription(current?.description ?? '')
    setArchived(current?.archived ?? false)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      if (isNew && current === null) await api.lists.create({ name: name.trim(), description: description.trim() })
      else if (current) await api.lists.update(current.id, { name: name.trim(), description: description.trim(), archived })
      toast('success', isNew ? 'List created' : 'List updated')
      onSaved()
    } catch (cause) {
      toast('error', 'Could not save the list', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={list !== null}
      onClose={onClose}
      title={isNew ? 'New list' : 'Edit list'}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {isNew ? 'Create list' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required hint="Used in the unsubscribe footer, so keep it recognisable.">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Product updates" autoFocus />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who joins this list and how often they hear from you." />
        </Field>
        {current ? <Toggle label="Archived" checked={archived} onChange={setArchived} hint="Archived lists are hidden from the audience picker." /> : null}
      </div>
    </Modal>
  )
}

function MembersModal({ list, onClose, onChanged }: { list: ListDto | null; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const members = useAsync(
    () => (list ? api.lists.contacts(list.id, { page, perPage: 10, q, status: 'all' }) : Promise.resolve(null)),
    [list?.id, page, q],
  )
  const contacts = useAsync(() => (list ? api.contacts.list({ q: email, perPage: 8, status: 'all' }) : Promise.resolve(null)), [email])

  if (!list) return null
  const paged: Paged<ContactDto> | null = members.data

  const addByEmail = async (): Promise<void> => {
    const match = contacts.data?.items.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase())
    if (!match) {
      toast('error', 'No contact with that email', 'Add them on the Contacts page first.')
      return
    }
    setBusy(true)
    try {
      await api.lists.addMembers(list.id, [match.id])
      toast('success', 'Added to list')
      setEmail('')
      members.reload()
      contacts.reload()
      onChanged()
    } catch (cause) {
      toast('error', 'Could not add the contact', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const totalPages = paged ? Math.min(paged.totalPages, Math.ceil(Math.max(1, paged.total) / 10)) : 1

  return (
    <Modal open onClose={onClose} title={list.name} subtitle={`${number(list.subscribedCount)} subscribed of ${number(list.contactCount)} members`} width="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <Field label="Add an existing contact" className="min-w-0 flex-1">
            <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ada@example.com" />
          </Field>
          <Button variant="primary" loading={busy} disabled={!email.includes('@')} onClick={() => void addByEmail()}>
            Add
          </Button>
        </div>
        {contacts.data?.items.length && email ? (
          <p className="text-[12px] text-slate-500">
            Matching: {contacts.data.items.map((candidate) => <span key={candidate.id} className="mr-2 font-mono">{candidate.email}</span>)}
          </p>
        ) : null}
        <Input className="!py-1.5 text-[12.5px]" placeholder="Filter members…" value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} />
        {members.loading && !paged ? (
          <Loading />
        ) : !paged?.items.length ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-[13px] text-slate-500">Nobody on this list yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200/70">
            {paged.items.map((contact) => (
              <li key={contact.id} className="flex items-center gap-2.5 px-3 py-2">
                <Avatar name={contact.name} email={contact.email} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-800">{contact.email}</span>
                  <span className="block text-[11.5px] text-slate-500">{contact.name || '—'}</span>
                </span>
                <ContactBadge status={contact.status} />
                <IconButton
                  label="Remove from list"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api.lists.removeMember(list.id, contact.id)
                      members.reload()
                      onChanged()
                    } catch (cause) {
                      toast('error', 'Could not remove', cause instanceof Error ? cause.message : undefined)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <IconTrash size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {paged && paged.total > 10 ? (
          <div className="flex items-center justify-between text-[12.5px] text-slate-500">
            <span>
              page {paged.page} of {totalPages} · {plural(paged.total, 'member')}
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={paged.page >= totalPages} onClick={() => setPage(paged.page + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
