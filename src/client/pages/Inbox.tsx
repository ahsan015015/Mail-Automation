import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync, useDebounced } from '../lib/hooks'
import { dateTime, number, relative } from '../lib/format'
import { Avatar, Badge, Button, Card, CardHead, Confirm, EmptyState, ErrorNote, IconButton, Input, PageHeader, Segmented, Skeleton } from '../components/ui'
import { IconCheck, IconCode, IconDownload, IconEye, IconInbox, IconMail, IconRefresh, IconTrash } from '../components/Icons'

/**
 * The local mail catcher: with the memory transport every message the engine
 * sends is stored here (and written as .eml to MAIL_DIR), so the whole product
 * is demoable without SMTP credentials.
 */
export function InboxPage() {
  const { toast, live } = useApp()
  usePageTitle('Inbox')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const [view, setView] = useState<'rendered' | 'source' | 'headers'>('rendered')
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  const query = useDebounced(search, 250)
  const list = useAsync(() => api.mailbox.list({ q: query, page, perPage: 20 }), [query, page, live.revision])
  const messages = list.data?.items ?? []
  const active = useMemo(() => messages.find((entry) => entry.id === openId) ?? null, [messages, openId])
  const detail = useAsync(() => (openId ? api.mailbox.get(openId) : Promise.resolve(null)), [openId, live.revision])
  const message = detail.data ?? (openId === active?.id ? active : null)

  const simulateOpen = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.mailbox.simulateOpen(id)
      toast('success', 'Open recorded', result.stats ? `Campaign open rate is now ${result.stats.openRate.toFixed(1)}%.` : undefined)
      list.reload()
      detail.reload()
    } catch (cause) {
      toast('error', 'Simulation failed', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Captured mail — what your recipients would receive, exactly as it left the server."
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={list.reload} loading={list.loading}>
              Refresh
            </Button>
            <Button variant="danger" icon={<IconTrash size={15} />} onClick={() => setConfirmClear(true)} disabled={!messages.length}>
              Clear
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-[12.5px] text-brand-900">
        <IconMail size={14} />
        Nothing leaves the machine while the transport is <code className="rounded bg-white/70 px-1">memory</code> — links, the open pixel and the unsubscribe route still work end to end.
        <Link to="/settings" className="ml-auto font-medium underline-offset-2 hover:underline">
          Switch to SMTP
        </Link>
      </div>

      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="flex max-h-[72vh] flex-col">
          <CardHead
            title="Messages"
            subtitle={`${number(list.data?.total ?? 0)} captured`}
            icon={<IconInbox size={16} />}
            actions={<Badge tone="emerald" dot>live</Badge>}
          />
          <div className="border-b border-slate-200/70 p-2.5">
            <Input className="!py-1.5 text-[12.5px]" placeholder="Search subject, recipient…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          </div>
          {list.loading && !list.data ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14" />
              ))}
            </div>
          ) : !messages.length ? (
            <EmptyState
              icon={<IconInbox size={18} />}
              title={query ? 'Nothing matches that search' : 'The catcher is empty'}
              body="Start a campaign (or send a test from the editor) and the message will appear here in under a second."
              action={
                <Link to="/campaigns" className="btn btn-primary btn-sm">
                  Go to campaigns
                </Link>
              }
            />
          ) : (
            <ul className="scroll-thin min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {messages.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(entry.id)
                      setView('rendered')
                    }}
                    className={`w-full px-3.5 py-2.5 text-left transition ${entry.id === openId ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar name={entry.toName} email={entry.toEmail} size={24} tone={entry.simulatedOpenAt ? 'emerald' : 'brand'} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-700">{entry.toEmail}</span>
                      <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{relative(entry.createdAt)}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] font-medium text-slate-900">{entry.subject || '(no subject)'}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {entry.campaignId ? <Badge tone="slate">#{entry.campaignId}</Badge> : null}
                      {entry.simulatedOpenAt ? (
                        <Badge tone="emerald">
                          <IconCheck size={10} /> opened
                        </Badge>
                      ) : null}
                      {entry.sendId ? <span className="text-[11px] text-slate-400">send {entry.sendId}</span> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && list.data.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-200/70 px-3 py-2 text-[12px] text-slate-500">
              <span>
                page {list.data.page} / {list.data.totalPages}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Prev
                </Button>
                <Button size="sm" variant="ghost" disabled={page >= list.data.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="min-h-[60vh]">
          {!message ? (
            <EmptyState icon={<IconMail size={18} />} title="No message selected" body="Pick one on the left to read it, inspect the raw source or open it in a new tab." />
          ) : (
            <>
              <CardHead
                title={message.subject || '(no subject)'}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span>
                      {message.fromName || message.fromEmail} → {message.toEmail}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span title={dateTime(message.createdAt)}>{dateTime(message.createdAt)}</span>
                  </span>
                }
                icon={<IconMail size={16} />}
                actions={
                  <>
                    <Segmented
                      size="sm"
                      value={view}
                      onChange={(next) => setView(next as typeof view)}
                      options={[
                        { value: 'rendered', label: 'Rendered' },
                        { value: 'source', label: 'HTML' },
                        { value: 'headers', label: 'Headers' },
                      ]}
                    />
                    <a className="btn btn-ghost btn-sm" href={api.mailbox.rawUrl(message.id)} download title="Download .eml">
                      <IconDownload size={14} /> .eml
                    </a>
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-4 py-2 text-[12px] text-slate-500">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{message.headers['list-unsubscribe'] ? 'List-Unsubscribe ✓' : 'no List-Unsubscribe'}</span>
                {message.headers['x-campaign'] ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">X-Campaign: {message.headers['x-campaign']}</span> : null}
                {message.headers['message-id'] ? <span className="truncate font-mono text-[11px]">{message.headers['message-id']}</span> : null}
                <Button size="sm" variant="ghost" className="ml-auto" icon={<IconEye size={13} />} loading={busy} onClick={() => void simulateOpen(message.id)}>
                  Simulate an open
                </Button>
              </div>

              {view === 'rendered' ? (
                <iframe
                  title="Rendered email"
                  className="h-[58vh] w-full bg-white"
                  sandbox=""
                  srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif}img{max-width:100%}</style></head><body>${message.html}</body></html>`}
                />
              ) : view === 'source' ? (
                <div className="p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-slate-500 uppercase">
                    <IconCode size={13} /> html body · {number(message.html.length)} chars
                  </p>
                  <pre className="scroll-thin max-h-[52vh] overflow-auto rounded-lg bg-slate-950 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-200">{message.html}</pre>
                  {message.text ? (
                    <>
                      <p className="mt-4 mb-2 text-[11.5px] font-medium tracking-wide text-slate-500 uppercase">plain-text alternative</p>
                      <pre className="scroll-thin max-h-40 overflow-auto rounded-lg border border-slate-200 px-3 py-2 text-[12px] whitespace-pre-wrap text-slate-600">{message.text}</pre>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="p-4">
                  <table className="table-base">
                    <tbody>
                      {Object.entries(message.headers).map(([key, value]) => (
                        <tr key={key}>
                          <td className="w-52 align-top font-mono text-[11.5px] text-slate-500">{key}</td>
                          <td className="break-all font-mono text-[11.5px] text-slate-700">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-[12px] text-slate-500">
                    Raw message file: <code className="rounded bg-slate-100 px-1 text-[11.5px]">{message.emlPath ?? 'synthesised on demand'}</code>
                  </p>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Confirm
        open={confirmClear}
        title="Clear the mail catcher?"
        body="Deletes every captured message and its .eml file. Campaign history, opens and clicks are untouched."
        confirmLabel="Clear mailbox"
        danger
        busy={busy}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setBusy(true)
          try {
            const result = await api.mailbox.clear()
            toast('success', 'Mailbox cleared', `${number(result.removed)} messages removed.`)
            setOpenId(null)
            list.reload()
          } catch (cause) {
            toast('error', 'Could not clear', cause instanceof Error ? cause.message : undefined)
          } finally {
            setBusy(false)
            setConfirmClear(false)
          }
        }}
      />
    </div>
  )
}
