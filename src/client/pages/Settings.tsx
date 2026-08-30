import { useEffect, useState } from 'react'
import type { WorkspaceSettings } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { number, relative } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  CardHead,
  Checkbox,
  Confirm,
  CopyButton,
  ErrorNote,
  Field,
  Input,
  Kpi,
  Loading,
  PageHeader,
  Segmented,
  Select,
  Toggle,
} from '../components/ui'
import { IconCheck, IconGauge, IconMail, IconRefresh, IconSend, IconSettings, IconWarn } from '../components/Icons'

type Draft = Omit<WorkspaceSettings, 'smtp'> & { smtp: WorkspaceSettings['smtp'] & { password: string } }

export function SettingsPage() {
  const { toast, user, refresh, signOut, workspaceName, demoMode } = useApp()
  usePageTitle('Settings')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [original, setOriginal] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [verify, setVerify] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([])

  const { data, error, loading, reload } = useAsync(() => api.settings.get(), [])
  const engine = useAsync(() => api.engine.status(), [])

  useEffect(() => {
    if (!data) return
    const next: Draft = { ...data, smtp: { ...data.smtp, password: '' } }
    setDraft(next)
    setOriginal(JSON.stringify(next))
  }, [data])

  const dirty = draft ? JSON.stringify(draft) !== original : false

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      const { smtp, ...rest } = draft
      const patch = {
        ...rest,
        smtp: smtp.password ? { ...smtp, password: smtp.password } : { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, pool: smtp.pool, maxMessages: smtp.maxMessages },
      }
      const next = await api.settings.update(patch as unknown as Record<string, unknown>)
      const hydrated: Draft = { ...next, smtp: { ...next.smtp, password: '' } }
      setDraft(hydrated)
      setOriginal(JSON.stringify(hydrated))
      setIssues([])
      await refresh()
      toast('success', 'Settings saved', 'New campaigns pick these up immediately.')
      reload()
      engine.reload()
    } catch (cause) {
      const failure = cause as { message?: string; issues?: { path: string; message: string }[] }
      setIssues(failure?.issues ?? [])
      toast('error', 'Could not save', failure?.message)
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    setBusy('verify')
    setVerify(null)
    try {
      const result = await api.settings.verify()
      setVerify({ ok: result.ok, message: result.message })
      toast(result.ok ? 'success' : 'error', result.ok ? 'SMTP connection looks good' : 'SMTP test failed', result.message)
    } catch (cause) {
      const failure = cause as { message?: string }
      setVerify({ ok: false, message: failure?.message ?? 'Could not reach the SMTP server' })
      toast('error', 'SMTP test failed', failure?.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !draft) return <Loading label="Loading settings" />
  if (!draft) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <ErrorNote error={error ?? { message: 'Settings unavailable' }} onRetry={reload} />
      </div>
    )
  }

  const hours = Array.from({ length: 24 }, (_, hour) => hour)

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{workspaceName}</span>
            <Badge tone={demoMode ? 'amber' : 'emerald'} dot>
              {demoMode ? 'memory transport' : 'smtp configured'}
            </Badge>
          </span>
        }
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={() => { reload(); engine.reload() }} loading={loading}>
              Reload
            </Button>
            <Button variant="primary" icon={<IconCheck size={15} />} loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
              {dirty ? 'Save changes' : 'Saved'}
            </Button>
          </>
        }
      />

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}
      {issues.length ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[12.5px] text-amber-800">
          {issues.map((issue) => (
            <p key={`${issue.path}-${issue.message}`}>
              <span className="font-mono text-[11.5px]">{issue.path}</span> — {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Transport"
          value={draft.transport}
          sub={engine.data ? `${draft.transport === 'memory' ? 'captured locally' : `${draft.smtp.host || 'no host'}:${draft.smtp.port}`}` : '…'}
          icon={<IconMail size={14} />}
          tone={demoMode ? 'amber' : 'emerald'}
        />
        <Kpi label="Outbox" value={number(engine.data?.queueDepth)} sub={engine.data?.running ? `ticking every ${Math.round(engine.data.tickMs / 1000)}s` : 'engine paused'} icon={<IconSend size={14} />} />
        <Kpi label="Last tick" value={engine.data?.lastTickAt ? relative(engine.data.lastTickAt) : 'never'} sub={engine.data ? `${engine.data.lifetime.sent} sent since boot` : undefined} icon={<IconGauge size={14} />} />
        <Kpi label="Retries" value={number(engine.data?.limits.maxAttempts)} sub={`${number(draft.sending.backoffBaseSeconds)}s backoff base`} icon={<IconWarn size={14} />} tone="slate" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead title="Workspace & sender" subtitle="defaults applied to every new campaign" icon={<IconMail size={16} />} />
          <div className="card-pad space-y-3">
            <Field label="Workspace name">
              <Input value={draft.workspaceName} onChange={(event) => setDraft({ ...draft, workspaceName: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From name" hint="Shown before the address in the inbox">
                <Input value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} placeholder="Acme" />
              </Field>
              <Field label="From email" required hint="Should exist on your sending domain">
                <Input value={draft.fromEmail} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} placeholder="hello@acme.dev" />
              </Field>
            </div>
            <Field label="Reply-to" hint="Empty means replies go to the from address">
              <Input value={draft.replyTo} onChange={(event) => setDraft({ ...draft, replyTo: event.target.value })} placeholder="support@acme.dev" />
            </Field>
            <p className="text-[12px] text-slate-500">
              Tracking links and the unsubscribe page are built from the public base URL the request arrived on, so reverse-proxying this app under your own domain is all it takes.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead title="Sending" subtitle="global pacing limits" icon={<IconGauge size={16} />} actions={<Badge tone="slate">campaign overrides win</Badge>} />
          <div className="card-pad space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Rate / minute">
                <Input type="number" min={1} max={6000} value={draft.sending.ratePerMinute} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, ratePerMinute: clamp(event.target.value, 1, 6000) } })} />
              </Field>
              <Field label="Daily cap">
                <Input type="number" min={1} value={draft.sending.dailyCap} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, dailyCap: clamp(event.target.value, 1, 1_000_000) } })} />
              </Field>
              <Field label="Max attempts">
                <Input type="number" min={1} max={20} value={draft.sending.maxAttempts} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, maxAttempts: clamp(event.target.value, 1, 20) } })} />
              </Field>
              <Field label="Backoff base (s)" hint="doubled per retry">
                <Input type="number" min={1} value={draft.sending.backoffBaseSeconds} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, backoffBaseSeconds: clamp(event.target.value, 1, 86_400) } })} />
              </Field>
              <Field label="Timezone">
                <Input value={draft.sending.timezone} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, timezone: event.target.value } })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="From hour">
                  <Select value={draft.sending.windowStartHour ?? ''} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, windowStartHour: event.target.value === '' ? null : Number(event.target.value) } })}>
                    <option value="">off</option>
                    {hours.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="To hour">
                  <Select value={draft.sending.windowEndHour ?? ''} onChange={(event) => setDraft({ ...draft, sending: { ...draft.sending, windowEndHour: event.target.value === '' ? null : Number(event.target.value) } })}>
                    <option value="">off</option>
                    {hours.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              A rate of {number(draft.sending.ratePerMinute)}/min with a {number(draft.sending.dailyCap)}-message daily cap moves about{' '}
              <span className="font-medium text-slate-800 tabular-nums">{number(Math.min(draft.sending.dailyCap, draft.sending.ratePerMinute * 60 * 12))}</span> messages in a 12-hour window.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead title="Transport" subtitle="where messages actually go" icon={<IconSettings size={16} />} />
          <div className="card-pad space-y-4">
            <Segmented
              value={draft.transport}
              onChange={(next) => setDraft({ ...draft, transport: next as Draft['transport'] })}
              options={[
                { value: 'auto', label: 'auto' },
                { value: 'smtp', label: 'smtp' },
                { value: 'memory', label: 'memory' },
              ]}
            />
            <p className="text-[12px] text-slate-500">
              <span className="font-medium text-slate-700">auto</span> uses SMTP as soon as a host is configured and otherwise writes every message to the local mail catcher
              (and to <code className="rounded bg-slate-100 px-1 text-[11.5px]">MAIL_DIR</code> as .eml).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SMTP host">
                <Input value={draft.smtp.host} onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, host: event.target.value } })} placeholder="smtp.postmarkapp.com" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Port">
                  <Input type="number" min={1} max={65535} value={draft.smtp.port} onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, port: clamp(event.target.value, 1, 65535) } })} />
                </Field>
                <Field label="Pool">
                  <Input type="number" min={1} max={20} value={draft.smtp.pool} onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, pool: clamp(event.target.value, 1, 20) } })} />
                </Field>
              </div>
              <Field label="Username">
                <Input value={draft.smtp.user} onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, user: event.target.value } })} autoComplete="off" />
              </Field>
              <Field label="Password" hint={draft.smtp.hasPassword ? 'Saved — leave empty to keep it.' : 'Never returned by the API.'}>
                <Input
                  type="password"
                  value={draft.smtp.password}
                  onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, password: event.target.value } })}
                  placeholder={draft.smtp.hasPassword ? '••••••••••••' : 'app password'}
                  autoComplete="new-password"
                />
              </Field>
              <div className="flex items-end gap-4 sm:col-span-2">
                <Checkbox label="Implicit TLS (port 465)" checked={draft.smtp.secure} onChange={(next) => setDraft({ ...draft, smtp: { ...draft.smtp, secure: next } })} />
                <Field label="Max messages per connection" className="w-48">
                  <Input type="number" min={1} max={1000} value={draft.smtp.maxMessages} onChange={(event) => setDraft({ ...draft, smtp: { ...draft.smtp, maxMessages: clamp(event.target.value, 1, 1000) } })} />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" loading={busy === 'verify'} disabled={!draft.smtp.host} onClick={() => void testConnection()}>
                Test connection
              </Button>
              {verify ? (
                <span className={`text-[12.5px] ${verify.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {verify.ok ? '✓ ' : '✕ '}
                  {verify.message}
                </span>
              ) : null}
              {draft.smtp.host && !draft.smtp.password && draft.smtp.hasPassword ? <Badge tone="slate">password kept</Badge> : null}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHead title="Tracking defaults" subtitle="each campaign can still opt out" icon={<IconCheck size={16} />} />
            <div className="card-pad space-y-2.5">
              <Toggle label="Track opens" checked={draft.tracking.openTracking} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, openTracking: next } })} hint="A 1×1 gif at the bottom of the HTML body." />
              <Toggle label="Track clicks" checked={draft.tracking.clickTracking} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, clickTracking: next } })} hint="Links become /t/c/<token> redirects." />
              <Toggle label="Append unsubscribe link" checked={draft.tracking.includeUnsubscribe} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, includeUnsubscribe: next } })} hint="Also sets the RFC 8058 List-Unsubscribe headers." />
              <Field label="Tracking domain" hint="Optional. Leave empty to reuse the URL the app is served from.">
                <Input value={draft.tracking.trackDomain} onChange={(event) => setDraft({ ...draft, tracking: { ...draft.tracking, trackDomain: event.target.value } })} placeholder="links.acme.dev" />
              </Field>
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600">{`${window.location.origin}/t/o/<token>.gif`}</code>
                <CopyButton value={`${window.location.origin}/t/o/example`} label="Copy" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Account" subtitle={user?.email} />
            <div className="card-pad space-y-3">
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">Signed in as</dt>
                  <dd className="font-medium text-slate-800">{user?.name || user?.email}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">Role</dt>
                  <dd className="font-medium text-slate-800">{user?.role}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">Session</dt>
                  <dd className="font-medium text-slate-800">cookie · signed out on demand</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void signOut()}>
                  Sign out
                </Button>
                <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                  Clear the mail catcher
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Confirm
        open={confirmReset}
        title="Clear every captured message?"
        body="Useful between demos. Sends, opens, clicks and contacts stay in the database."
        confirmLabel="Clear mailbox"
        danger
        busy={busy === 'clear'}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setBusy('clear')
          try {
            const result = await api.mailbox.clear()
            toast('success', 'Mailbox cleared', `${number(result.removed)} messages removed.`)
          } catch (cause) {
            toast('error', 'Could not clear', cause instanceof Error ? cause.message : undefined)
          } finally {
            setBusy(null)
            setConfirmReset(false)
          }
        }}
      />
    </div>
  )
}

function clamp(raw: string, min: number, max: number): number {
  const value = Math.round(Number(raw || min))
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
