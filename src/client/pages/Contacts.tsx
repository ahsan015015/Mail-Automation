import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ContactDto, ContactStatus, ImportResult, ListDto } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api, type ContactQuery } from '../lib/api'
import { useAsync, useDebounced } from '../lib/hooks'
import { dateTime, number, plural, relative } from '../lib/format'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Confirm,
  ContactBadge,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Segmented,
  Select,
  Loading,
  Skeleton,
  Textarea,
  Toggle,
} from '../components/ui'
import { IconDownload, IconEye, IconPlus, IconRefresh, IconTag, IconTrash, IconUpload, IconUsers } from '../components/Icons'

const STATUSES = ['all', 'subscribed', 'unsubscribed', 'bounced', 'complained', 'pending'] as const
const SORTS = [
  { value: 'created_desc', label: 'Newest' },
  { value: 'created_asc', label: 'Oldest' },
  { value: 'email_asc', label: 'Email A→Z' },
  { value: 'opened_desc', label: 'Most opened' },
] as const

export function ContactsPage() {
  const { toast, live } = useApp()
  usePageTitle('Contacts')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('subscribed')
  const [listId, setListId] = useState<number | ''>('')
  const [tagId, setTagId] = useState<number | ''>('')
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('created_desc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<ContactDto | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkListOpen, setBulkListOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const query = useDebounced(search, 250)
  const filters = useMemo<ContactQuery>(
    () => ({ status, listId: listId || undefined, tagId: tagId || undefined, sort, page, perPage: 25, q: query }),
    [status, listId, tagId, sort, page, query],
  )

  const { data, error, loading, reload } = useAsync(() => api.contacts.list(filters), [JSON.stringify(filters), live.revision])
  const audience = useAsync(() => api.stats.dashboard().then((result) => result.totals), [live.revision])
  const lists = useAsync(() => api.lists.list(), [live.revision])
  const tags = useAsync(() => api.tags.list(), [live.revision])

  const toggleSelect = (id: number): void =>
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))

  const removeMany = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.contacts.removeMany(selected)
      toast('success', `${number(result.deleted)} ${plural(result.deleted, 'contact')} deleted`)
      setSelected([])
      setConfirmDelete(false)
      setDetail(null)
      reload()
    } catch (cause) {
      toast('error', 'Delete failed', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const addToList = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.lists.addMembers(id, selected)
      toast('success', 'Added to list', `${number(result.added)} contacts.`)
      setBulkListOpen(false)
      reload()
    } catch (cause) {
      toast('error', 'Could not update the list', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const totals = audience.data

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={
          totals
            ? `${number(totals.subscribed)} subscribed · ${number(totals.unsubscribed)} unsubscribed · ${number(totals.bounced)} bounced`
            : 'Everyone you can send to, with their history.'
        }
        actions={
          <>
            <a className="btn btn-secondary" href={api.contacts.exportUrl({ ...filters, page: 1, perPage: 1 })} download>
              <IconDownload size={15} /> Export CSV
            </a>
            <Button icon={<IconUpload size={15} />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreateOpen(true)}>
              Add contact
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented
            size="sm"
            value={status}
            onChange={(next) => {
              setStatus(next as (typeof STATUSES)[number])
              setPage(1)
            }}
            options={STATUSES.map((entry) => ({ value: entry, label: entry }))}
          />
          <Input
            className="!w-full max-w-[220px] !py-1.5 text-[12.5px]"
            placeholder="Search email, name, fields…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
          <Select
            className="!w-auto !py-1.5 text-[12.5px]"
            value={listId}
            onChange={(event) => {
              setListId(event.target.value ? Number(event.target.value) : '')
              setPage(1)
            }}
          >
            <option value="">All lists</option>
            {(lists.data?.items ?? []).map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.subscribedCount})
              </option>
            ))}
          </Select>
          <Select
            className="!w-auto !py-1.5 text-[12.5px]"
            value={tagId}
            onChange={(event) => {
              setTagId(event.target.value ? Number(event.target.value) : '')
              setPage(1)
            }}
          >
            <option value="">All tags</option>
            {(tags.data?.items ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                #{tag.name}
              </option>
            ))}
          </Select>
          <Select
            className="!w-auto !py-1.5 text-[12.5px]"
            value={sort}
            onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['value'])}
          >
            {SORTS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" icon={<IconRefresh size={13} />} onClick={reload} loading={loading}>
            Refresh
          </Button>
          <span className="ml-auto text-[12px] text-slate-500 tabular-nums">{data ? `${number(data.total)} matching` : ''}</span>
        </div>

        {error ? (
          <div className="px-3 pb-3">
            <ErrorNote error={error} onRetry={reload} />
          </div>
        ) : null}

        {selected.length ? (
          <div className="flex flex-wrap items-center gap-2 border-y border-brand-100 bg-brand-50/70 px-3 py-2 text-[12.5px] text-brand-900">
            <span className="font-medium">{number(selected.length)} selected</span>
            <Button size="sm" variant="secondary" onClick={() => setBulkListOpen(true)}>
              Add to list
            </Button>
            <Button size="sm" variant="danger" icon={<IconTrash size={13} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <button type="button" className="ml-auto underline-offset-2 hover:underline" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<IconUsers size={18} />}
            title={query || status !== 'subscribed' || listId || tagId ? 'No contacts match these filters' : 'No contacts yet'}
            body="Import a CSV, add someone by hand, or let your public list form collect signups."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="primary" icon={<IconUpload size={13} />} onClick={() => setImportOpen(true)}>
                  Import CSV
                </Button>
                <Link to="/lists" className="btn btn-secondary btn-sm">
                  Lists & subscribe form
                </Link>
              </div>
            }
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Contact</th>
                  <th className="hidden md:table-cell">Status</th>
                  <th className="hidden lg:table-cell">Lists & tags</th>
                  <th className="hidden sm:table-cell text-right">Engagement</th>
                  <th className="hidden xl:table-cell">Last activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((contact) => (
                  <tr key={contact.id} className="group">
                    <td>
                      <input
                        type="checkbox"
                        className="size-3.5 accent-indigo-600"
                        checked={selected.includes(contact.id)}
                        onChange={() => toggleSelect(contact.id)}
                        aria-label={`Select ${contact.email}`}
                      />
                    </td>
                    <td>
                      <button type="button" className="flex items-center gap-2.5 text-left" onClick={() => setDetail(contact)}>
                        <Avatar name={contact.name} email={contact.email} size={30} />
                        <span className="min-w-0">
                          <span className="block max-w-[240px] truncate text-[13.5px] font-medium text-slate-800 group-hover:text-brand-700">{contact.email}</span>
                          <span className="block text-[12px] text-slate-500">{contact.name || `${Object.keys(contact.fields).length} custom fields`}</span>
                        </span>
                      </button>
                    </td>
                    <td className="hidden md:table-cell">
                      <ContactBadge status={contact.status} />
                    </td>
                    <td className="hidden lg:table-cell">
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {contact.lists.map((list) => (
                          <Badge key={list.id} tone="brand">
                            {list.name}
                          </Badge>
                        ))}
                        {contact.tags.map((tag) => (
                          <Badge key={tag.id} tone="violet">
                            <IconTag size={10} /> {tag.name}
                          </Badge>
                        ))}
                        {!contact.lists.length && !contact.tags.length ? <span className="text-[12px] text-slate-400">—</span> : null}
                      </div>
                    </td>
                    <td className="hidden text-right text-[12.5px] text-slate-600 tabular-nums sm:table-cell">
                      <span className="inline-flex items-center gap-2">
                        <span title={`${contact.sentCount} emails sent`}>{number(contact.sentCount)} sent</span>
                        <span className="inline-flex items-center gap-1 text-sky-600" title="opens">
                          <IconEye size={12} />
                          {contact.openCount}
                        </span>
                      </span>
                    </td>
                    <td className="hidden text-[12px] text-slate-500 xl:table-cell">
                      {contact.lastOpenAt ? `opened ${relative(contact.lastOpenAt)}` : contact.createdAt ? `joined ${relative(contact.createdAt)}` : '—'}
                    </td>
                    <td className="text-right">
                      <IconButton label="Open contact" onClick={() => setDetail(contact)}>
                        <IconEye size={14} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} /> : null}
      </Card>

      {detail ? (
        <ContactDrawer
        key={detail.id}
        contact={detail}
        onClose={() => setDetail(null)}
        lists={lists.data?.items ?? []}
        onChange={() => {
          reload()
          audience.reload()
        }}
        onDeleted={() => {
          setDetail(null)
          reload()
        }}
      />
      ) : null}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        lists={lists.data?.items ?? []}
        onDone={() => {
          reload()
          audience.reload()
          lists.reload()
        }}
      />

      <CreateContact
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        lists={lists.data?.items ?? []}
        onDone={reload}
      />

      <Modal open={bulkListOpen} onClose={() => setBulkListOpen(false)} title="Add selected contacts to a list" width="max-w-md">
        {lists.data?.items.length ? (
          <ul className="divide-y divide-slate-100">
            {lists.data.items.map((list) => (
              <li key={list.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-slate-800">{list.name}</p>
                  <p className="text-[12px] text-slate-500">{number(list.subscribedCount)} subscribed</p>
                </div>
                <Button size="sm" loading={busy} onClick={() => void addToList(list.id)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">You need a list first — create one on the Lists page.</p>
        )}
      </Modal>

      <Confirm
        open={confirmDelete}
        title={`Delete ${number(selected.length)} contacts?`}
        body="Their send history and events are kept for reporting, but they will never receive email again until re-imported."
        confirmLabel="Delete contacts"
        danger
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void removeMany()}
      />
    </div>
  )
}

/* ── drawer ────────────────────────────────────────────────────────────────── */

function ContactDrawer({
  contact,
  onClose,
  lists,
  onChange,
  onDeleted,
}: {
  contact: ContactDto
  onClose: () => void
  lists: ListDto[]
  onChange: () => void
  onDeleted: () => void
}) {
  const { toast } = useApp()
  const [form, setForm] = useState<ContactDto>(contact)
  const [busy, setBusy] = useState(false)
  const events = useAsync(() => api.contacts.events(contact.id), [contact.id])

  const current = form

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const listIds = (current.lists ?? []).map((list) => list.id)
      const tags = (current.tags ?? []).map((tag) => tag.name)
      await api.contacts.update(current.id, { email: current.email, name: current.name, status: current.status, fields: current.fields, listIds, tags })
      toast('success', 'Contact saved')
      onChange()
    } catch (cause) {
      toast('error', 'Could not save', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: ContactStatus): Promise<void> => {
    setBusy(true)
    try {
      if (status === 'unsubscribed') await api.contacts.unsubscribe(current.id)
      else if (status === 'subscribed') await api.contacts.resubscribe(current.id)
      toast('success', status === 'subscribed' ? 'Subscribed again' : 'Unsubscribed')
      onChange()
      onClose()
    } catch (cause) {
      toast('error', 'That did not work', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Avatar name={current.name} email={current.email} size={28} />
          <span className="truncate">{current.email}</span>
        </span>
      }
      subtitle={`${number(current.sentCount)} emails · joined ${relative(current.createdAt)}`}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<IconTrash size={14} />}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.contacts.remove(current.id)
                toast('success', 'Contact deleted')
                onDeleted()
              } catch (cause) {
                toast('error', 'Delete failed', cause instanceof Error ? cause.message : undefined)
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete
          </Button>
          <div className="ml-auto flex gap-2">
            {current.status === 'subscribed' ? (
              <Button variant="secondary" loading={busy} onClick={() => void setStatus('unsubscribed')}>
                Unsubscribe
              </Button>
            ) : (
              <Button variant="secondary" loading={busy} onClick={() => void setStatus('subscribed')}>
                Subscribe
              </Button>
            )}
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <Input value={current.email} onChange={(event) => setForm({ ...current, email: event.target.value })} />
          </Field>
          <Field label="Name">
            <Input value={current.name} onChange={(event) => setForm({ ...current, name: event.target.value })} placeholder="Ahsan Rahman" />
          </Field>
          <Field label="Status">
            <Select value={current.status} onChange={(event) => setForm({ ...current, status: event.target.value as ContactStatus })}>
              {(['subscribed', 'unsubscribed', 'bounced', 'complained', 'pending'] as const).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" hint="Comma separated — new names are created automatically.">
            <Input
              value={(current.tags ?? []).map((tag) => tag.name).join(', ')}
              onChange={(event) => setForm({ ...current, tags: event.target.value.split(',').map((name) => name.trim()).filter(Boolean).map((name, index) => ({ id: -index - 1, name, color: '#6366f1', contactCount: 0 })) })}
            />
          </Field>
        </div>

        <div>
          <p className="label">Lists</p>
          <div className="flex flex-wrap gap-1.5">
            {lists.map((list) => {
              const active = (current.lists ?? []).some((entry) => entry.id === list.id)
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...current,
                      lists: active ? (current.lists ?? []).filter((entry) => entry.id !== list.id) : [...(current.lists ?? []), { id: list.id, name: list.name }],
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition ${active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {list.name}
                </button>
              )
            })}
            {!lists.length ? <p className="text-[12.5px] text-slate-400">No lists yet.</p> : null}
          </div>
        </div>

        <FieldMerge current={current} setForm={setForm} />

        <div>
          <p className="label">Recent activity</p>
          {events.loading ? (
            <Loading />
          ) : !events.data?.items.length ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500">No opens, clicks or bounces recorded for this contact yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200/70">
              {events.data.items.slice(0, 20).map((event) => (
                <li key={event.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <Badge tone={event.kind.includes('open') ? 'sky' : event.kind.includes('click') ? 'emerald' : 'slate'}>{event.kind.replace('.', ' ')}</Badge>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{event.message}</span>
                  <span className="shrink-0 text-slate-400 tabular-nums" title={dateTime(event.createdAt)}>
                    {relative(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function FieldMerge({ current, setForm }: { current: ContactDto; setForm: (next: ContactDto) => void }) {
  const entries = Object.entries(current.fields ?? {})
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="label">Merge fields</p>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconPlus size={12} />}
          onClick={() => {
            const key = window.prompt('Field name', 'company')
            if (!key) return
            setForm({ ...current, fields: { ...current.fields, [key.trim()]: '' } })
          }}
        >
          Add field
        </Button>
      </div>
      {entries.length ? (
        <div className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <code className="w-28 shrink-0 truncate rounded bg-slate-100 px-2 py-1 text-[11.5px] text-slate-600">{`{{${key}}}`}</code>
              <Input
                className="!py-1.5 text-[12.5px]"
                value={value}
                onChange={(event) => setForm({ ...current, fields: { ...current.fields, [key]: event.target.value } })}
              />
              <IconButton label={`Remove ${key}`} onClick={() => setForm({ ...current, fields: Object.fromEntries(entries.filter(([name]) => name !== key)) })}>
                <IconTrash size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500">Custom fields power <code>{'{{company}}'}</code> and friends in your emails.</p>
      )}
    </div>
  )
}

/* ── import ────────────────────────────────────────────────────────────────── */

const SAMPLE = `email,name,company,tags
ada@example.com,Ada Quill,Northwind,trial,beta
grace@example.com,Grace Hopper,Compiler Labs,trial`

function ImportDialog({ open, onClose, lists, onDone }: { open: boolean; onClose: () => void; lists: ListDto[]; onDone: () => void }) {
  const { toast } = useApp()
  const [csv, setCsv] = useState('')
  const [listId, setListId] = useState<number | ''>('')
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'update'>('update')
  const [defaultStatus, setDefaultStatus] = useState<ContactStatus>('subscribed')
  const [tags, setTags] = useState('')
  const [sendMail, setSendMail] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const output = await api.contacts.import({
        csv,
        listId: listId || undefined,
        duplicatePolicy,
        defaultStatus,
        tags: tags.split(',').map((entry) => entry.trim()).filter(Boolean),
        sendMail,
      })
      setResult(output)
      toast('success', 'Import finished', `${number(output.created)} created, ${number(output.updated)} updated.`)
      onDone()
    } catch (cause) {
      toast('error', 'Import failed', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
    setResult(null)
    setCsv('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Import contacts"
      subtitle="Paste CSV or drop a file — the first row holds the column names."
      width="max-w-2xl"
      footer={
        result ? (
          <Button variant="primary" onClick={reset}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!csv.trim()} onClick={() => void run()}>
              Import
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Created', result.created, 'emerald'],
              ['Updated', result.updated, 'sky'],
              ['Skipped', result.skipped.length, 'amber'],
              ['Tags created', result.tagsCreated, 'violet'],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="rounded-lg border border-slate-200/70 px-3 py-2">
                <p className="text-[11.5px] text-slate-500">{label}</p>
                <p className="text-[18px] font-semibold tabular-nums">
                  <Badge tone={tone as 'emerald'}>{number(Number(value))}</Badge>
                </p>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-slate-500">
            Columns detected: {result.columns.map((column) => <code key={column} className="mr-1 rounded bg-slate-100 px-1 text-[11.5px]">{column}</code>)}
          </p>
          {result.skipped.length ? (
            <div className="scroll-thin max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/60">
              {result.skipped.map((row, index) => (
                <p key={index} className="px-3 py-1.5 text-[12.5px] text-amber-800">
                  line {row.line}: {row.reason}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Add to list">
              <Select value={listId} onChange={(event) => setListId(event.target.value ? Number(event.target.value) : '')}>
                <option value="">No list</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="On duplicates">
              <Segmented
                size="sm"
                value={duplicatePolicy}
                onChange={(next) => setDuplicatePolicy(next as 'skip' | 'update')}
                options={[
                  { value: 'update', label: 'update them' },
                  { value: 'skip', label: 'skip' },
                ]}
              />
            </Field>
            <Field label="Status for new contacts">
              <Select value={defaultStatus} onChange={(event) => setDefaultStatus(event.target.value as ContactStatus)}>
                {(['subscribed', 'pending'] as const).map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tag everyone" hint="Comma separated">
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="imported, 2026-03" />
            </Field>
          </div>
          <Toggle label="Send a welcome email" checked={sendMail} onChange={setSendMail} hint="Only for newly created contacts." />
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12.5px] text-slate-500 hover:bg-slate-50">
            <IconUpload size={14} />
            choose a .csv file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (file) setCsv(await file.text())
              }}
            />
          </label>
          <Textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={9} placeholder={SAMPLE} className="font-mono !text-[12px]" />
          <p className="hint">
            <code>email</code> is required; <code>name</code>, <code>tags</code> and any other column become merge fields.
          </p>
        </div>
      )}
    </Modal>
  )
}

/* ── create ────────────────────────────────────────────────────────────────── */

function CreateContact({ open, onClose, lists, onDone }: { open: boolean; onClose: () => void; lists: ListDto[]; onDone: () => void }) {
  const { toast } = useApp()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [fields, setFields] = useState('company=')
  const [listIds, setListIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const parsed: Record<string, string> = {}
      for (const line of fields.split('\n')) {
        const index = line.indexOf('=')
        if (index > 0) parsed[line.slice(0, index).trim()] = line.slice(index + 1).trim()
      }
      await api.contacts.create({ email: email.trim(), name: name.trim(), fields: parsed, listIds, status: 'subscribed' })
      toast('success', 'Contact added')
      setEmail('')
      setName('')
      setListIds([])
      onDone()
      onClose()
    } catch (cause) {
      toast('error', 'Could not add the contact', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a contact"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!email.includes('@')} onClick={() => void create()}>
            Add contact
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Email" required>
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ada@example.com" autoFocus />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ada Quill" />
        </Field>
        <Field label="Merge fields" hint="One per line, as key=value.">
          <Textarea rows={3} value={fields} onChange={(event) => setFields(event.target.value)} className="font-mono !text-[12px]" />
        </Field>
        {lists.length ? (
          <Field label="Lists">
            <div className="flex flex-wrap gap-1.5">
              {lists.map((list) => {
                const active = listIds.includes(list.id)
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => setListIds((current) => (active ? current.filter((entry) => entry !== list.id) : [...current, list.id]))}
                    className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition ${active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    {list.name}
                  </button>
                )
              })}
            </div>
          </Field>
        ) : (
          <p className="hint">Tip: create lists first so imported people land somewhere.</p>
        )}
      </div>
    </Modal>
  )
}
