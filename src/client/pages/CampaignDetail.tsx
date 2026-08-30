import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EMPTY_STATS, type CampaignDto, type CampaignSchedule, type StepDto } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { dateTime, number, percent, relative, toLocalInput, fromLocalInput } from '../lib/format'
import { ContentEditor, DelayBadge, DelayPicker, emptyStep, fromTemplate } from '../components/Editor'
import { SegmentEditor } from '../components/SegmentEditor'
import { SendsTable } from '../components/SendsTable'
import {
  Badge,
  Button,
  CampaignBadge,
  Card,
  CardHead,
  Checkbox,
  Confirm,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Kpi,
  Loading,
  Modal,
  PageHeader,
  Progress,
  Select,
  Tabs,
  Toggle,
} from '../components/ui'
import { ActivityChart, FunnelBars } from '../components/Charts'
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconClick,
  IconClock,
  IconCopy,
  IconEye,
  IconMail,
  IconPause,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSend,
  IconStop,
  IconTemplate,
  IconTrash,
  IconWarn,
} from '../components/Icons'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'content', label: 'Content' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'settings', label: 'Settings' },
] as const
type Tab = (typeof TABS)[number]['value']

export function CampaignDetailPage() {
  const { id } = useParams()
  const campaignId = Number(id)
  const { toast, live } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [busy, setBusy] = useState<string | null>(null)

  const { data, error, loading, reload } = useAsync(async () => {
    const campaign = await api.campaigns.get(campaignId)
    const [stats, series, events] = await Promise.all([
      api.campaigns.stats(campaign.id).catch(() => null),
      api.campaigns.series(campaign.id, 48).catch(() => null),
      api.campaigns.events(campaign.id).catch(() => null),
    ])
    return { campaign, stats, series, events }
  }, [campaignId, live.revision])

  const campaign = data?.campaign ?? null
  usePageTitle(campaign ? campaign.name : 'Campaign')

  const [draft, setDraft] = useState<CampaignDto | null>(null)
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof api.templates.list>>['items']>([])
  const [activeStep, setActiveStep] = useState(0)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [at, setAt] = useState('')
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [problems, setProblems] = useState<string[] | null>(null)

  const dirty = useRef(false)
  useEffect(() => {
    if (!campaign || dirty.current) return
    setDraft(campaign)
  }, [campaign?.id, campaign?.updatedAt])

  useEffect(() => {
    api.templates
      .list()
      .then((result) => setTemplates(result.items))
      .catch(() => undefined)
  }, [live.revision])

  const editable = !campaign || ['draft', 'scheduled', 'paused'].includes(campaign.status)
  const steps = draft?.steps ?? []
  const step = steps[activeStep] ?? null

  const run = async (label: string, action: () => Promise<unknown>, message?: string): Promise<void> => {
    setBusy(label)
    try {
      await action()
      toast('success', message ?? 'Done')
      reload()
    } catch (cause) {
      toast('error', 'That did not work', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!draft || !campaign) return
    setBusy('save')
    try {
      if (editable) {
        await api.campaigns.update(campaign.id, {
          name: draft.name,
          fromName: draft.fromName,
          fromEmail: draft.fromEmail,
          replyTo: draft.replyTo,
          segment: draft.segment,
          schedule: draft.schedule,
          tracking: draft.tracking,
        })
      }
      // steps go through their own endpoints so a step that already sent mail is never recreated
      for (const entry of draft.steps) {
        const { id: stepId, campaignId: _ignored, ...content } = entry
        if (stepId) await api.campaigns.updateStep(campaign.id, stepId, content)
        else await api.campaigns.addStep(campaign.id, content)
      }
      dirty.current = false
      toast('success', 'Changes saved')
      setProblems(null)
      setScheduleOpen(false)
      reload()
    } catch (cause) {
      const error = cause as { message?: string; issues?: { path: string; message: string }[] }
      toast('error', 'Could not save', error?.message)
      setProblems((error?.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`))
    } finally {
      setBusy(null)
    }
  }

  const updateStep = (patch: Partial<StepDto>): void => {
    dirty.current = true
    setDraft((current) => {
      if (!current) return current
      return { ...current, steps: current.steps.map((entry, index) => (index === activeStep ? { ...entry, ...patch } : entry)) }
    })
  }

  const stats = campaign?.stats ?? EMPTY_STATS
  const kpis = useMemo(
    () =>
      campaign
        ? [
            { label: 'Recipients', value: number(stats.recipients), sub: `${number(stats.sent)} delivered`, icon: <IconMail size={14} />, tone: 'brand' as const },
            { label: 'Queued', value: number(stats.queued), sub: stats.nextSendAt ? `next ${relative(stats.nextSendAt)}` : 'nothing waiting', icon: <IconClock size={14} />, tone: 'slate' as const },
            { label: 'Open rate', value: percent(stats.openRate), sub: `${number(stats.opens)} opens · ${number(stats.uniqueOpens)} unique`, icon: <IconEye size={14} />, tone: 'sky' as const },
            { label: 'Click rate', value: percent(stats.clickRate), sub: `${number(stats.clicks)} clicks · ${number(stats.uniqueClicks)} unique`, icon: <IconClick size={14} />, tone: 'emerald' as const },
            { label: 'Unsubscribes', value: number(stats.unsubscribes), sub: `${number(stats.bounced)} bounced · ${number(stats.failed)} failed`, icon: <IconWarn size={14} />, tone: stats.bounced + stats.failed > 0 ? ('rose' as const) : ('slate' as const) },
          ]
        : [],
    [campaign, stats],
  )

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <ErrorNote error={error} onRetry={reload} />
        <Link to="/campaigns" className="btn btn-secondary btn-sm mt-4">
          Back to campaigns
        </Link>
      </div>
    )
  }
  if (!campaign || !draft) return <Loading label="Loading campaign" />

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="/campaigns" className="text-slate-400 hover:text-brand-700">
              Campaigns
            </Link>
            <span className="text-slate-300">/</span>
            <span className="truncate">{campaign.name}</span>
            <CampaignBadge status={campaign.status} />
            <Badge tone="violet">{campaign.type === 'broadcast' ? 'broadcast' : `${campaign.steps.length}-step drip`}</Badge>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {campaign.fromName || campaign.fromEmail} → {number(campaign.recipientCount)} contacts
            </span>
            {campaign.scheduledStartAt ? <span className="text-sky-700">starts {dateTime(campaign.scheduledStartAt)}</span> : null}
            {campaign.completedAt ? <span className="text-slate-400">completed {relative(campaign.completedAt)}</span> : null}
          </span>
        }
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
            {editable ? (
              <Button icon={<IconCheck size={15} />} loading={busy === 'save'} onClick={() => void save()}>
                Save changes
              </Button>
            ) : null}
            {['draft', 'paused', 'scheduled'].includes(campaign.status) ? (
              <Button
                variant="primary"
                icon={<IconPlay size={15} />}
                loading={busy === 'start'}
                onClick={() =>
                  campaign.status === 'draft'
                    ? setScheduleOpen(true)
                    : void run('resume', () => api.campaigns.resume(campaign.id), 'Campaign resumed')
                }
              >
                {campaign.status === 'draft' ? 'Send now' : 'Resume'}
              </Button>
            ) : null}
            {campaign.status === 'running' ? (
              <Button icon={<IconPause size={15} />} loading={busy === 'pause'} onClick={() => void run('pause', () => api.campaigns.pause(campaign.id), 'Campaign paused')}>
                Pause
              </Button>
            ) : null}
            {['running', 'scheduled', 'paused'].includes(campaign.status) ? (
              <IconButton label="Cancel sending" onClick={() => setConfirm('cancel')}>
                <IconStop size={15} />
              </IconButton>
            ) : null}
            <IconButton label="Duplicate" onClick={() => void run('duplicate', async () => { const copy = await api.campaigns.duplicate(campaign.id); navigate(`/campaigns/${copy.id}`) }, 'Campaign duplicated')}>
              <IconCopy size={15} />
            </IconButton>
            {['draft', 'canceled', 'completed'].includes(campaign.status) ? (
              <IconButton label="Delete campaign" onClick={() => setConfirm('delete')}>
                <IconTrash size={15} />
              </IconButton>
            ) : null}
          </>
        }
      />

      {stats.recipients > 0 ? (
        <div className="mb-1">
          <div className="flex items-center justify-between text-[12px] text-slate-500">
            <span className="tabular-nums">
              {number(stats.sent)} of {number(stats.recipients)} sent · {number(stats.queued)} queued
            </span>
            <span className="tabular-nums">{percent(stats.progress)} complete</span>
          </div>
          <Progress className="mt-1.5" value={stats.progress} tone={campaign.status === 'running' ? 'emerald' : 'brand'} />
        </div>
      ) : null}

      {stats.failed + stats.bounced > 0 && ['running', 'paused'].includes(campaign.status) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <IconWarn size={14} />
          {number(stats.failed)} transient failures and {number(stats.bounced)} hard bounces.
          <Button size="sm" variant="ghost" loading={busy === 'retry'} onClick={() => void run('retry', () => api.campaigns.retryFailed(campaign.id), 'Failures requeued')}>
            Retry failures
          </Button>
        </div>
      ) : null}

      <div className="mt-4">
        <Tabs tabs={TABS.map((entry) => ({ value: entry.value, label: entry.label, badge: entry.value === 'delivery' ? <Badge tone="slate">{number(stats.queued)}</Badge> : undefined }))} value={tab} onChange={setTab} />
      </div>

      {tab === 'overview' ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {kpis.map((kpi) => (
              <Kpi key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} icon={kpi.icon} tone={kpi.tone} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHead title="Last 48 hours" subtitle="sends, opens and clicks per hour" icon={<IconSend size={16} />} />
              <div className="p-4">
                <ActivityChart points={data?.series?.points ?? []} height={150} />
              </div>
            </Card>
            <Card>
              <CardHead title="Funnel" subtitle="how the audience converted" icon={<IconEye size={16} />} />
              <div className="card-pad">
                {data?.stats?.funnel?.length ? <FunnelBars points={data.stats.funnel} /> : <EmptyState title="No data yet" body="The funnel fills in as messages are delivered and opened." />}
              </div>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <Card>
              <CardHead title="Latest activity" actions={<Badge tone="slate">{number(data?.events?.items.length ?? 0)} shown</Badge>} />
              {!data?.events?.items.length ? (
                <EmptyState title="Nothing logged yet" body="Queue, send, open, click and bounce events for this campaign appear here." />
              ) : (
                <ul className="scroll-thin max-h-[380px] divide-y divide-slate-100 overflow-y-auto">
                  {data.events.items.map((event) => (
                    <li key={event.id} className="flex items-start gap-2.5 px-4 py-2.5 text-[13px]">
                      <span className="mt-0.5 shrink-0 font-medium text-slate-700">{event.kind.replace('.', ' ')}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-500">{event.message}</span>
                      <span className="shrink-0 text-[12px] text-slate-400 tabular-nums" title={dateTime(event.createdAt)}>
                        {relative(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHead title="Sending plan" />
              <dl className="card-pad space-y-2 text-[13px]">
                {[
                  ['Status', <CampaignBadge key="s" status={campaign.status} />],
                  ['From', `${campaign.fromName || '—'} <${campaign.fromEmail}>`],
                  ['Reply-to', campaign.replyTo || 'same as from'],
                  ['Rate', `${number(campaign.schedule.ratePerMinute)} / min`],
                  ['Daily cap', number(campaign.schedule.dailyCap)],
                  ['Window', campaign.schedule.windowStartHour !== null ? `${campaign.schedule.windowStartHour}:00 – ${campaign.schedule.windowEndHour}:00` : 'unlimited'],
                  ['Weekends', campaign.schedule.skipWeekends ? 'skipped' : 'included'],
                  ['Open tracking', campaign.tracking.openTracking ? 'on' : 'off'],
                  ['Click tracking', campaign.tracking.clickTracking ? 'on' : 'off'],
                  ['Unsubscribe', campaign.tracking.includeUnsubscribe ? 'appended' : 'manual only'],
                ].map(([label, value], index) => (
                  <div key={index} className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'content' ? (
        <div className="mt-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-4 py-2.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {steps.map((entry, index) => (
                  <button
                    key={entry.id || `${entry.name}-${index}`}
                    type="button"
                    onClick={() => setActiveStep(index)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                      index === activeStep ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {index + 1}. {entry.name || `Email ${index + 1}`}
                    {campaign.type === 'sequence' ? <DelayBadge minutes={entry.delayMinutes} /> : null}
                  </button>
                ))}
              </div>
              {editable || campaign.status === 'running' ? (
                <Button size="sm" variant="ghost" icon={<IconPlus size={13} />} onClick={() => setDraft({ ...draft, steps: [...steps, emptyStep(steps.length)] })}>
                  Add step
                </Button>
              ) : null}
            </div>

            {step ? (
              <div className="card-pad space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Step name" className="min-w-[200px] flex-1">
                    <Input value={step.name} onChange={(event) => updateStep({ name: event.target.value })} disabled={!editable} />
                  </Field>
                  {campaign.type === 'sequence' ? (
                    <Field label="Delay before this email">
                      <DelayPicker minutes={step.delayMinutes} onChange={(minutes) => updateStep({ delayMinutes: minutes })} />
                    </Field>
                  ) : null}
                  <Field label="Template">
                    <Select
                      className="!w-auto !py-2 text-[12.5px]"
                      value={step.templateId ?? ''}
                      onChange={(event) => {
                        const templateId = event.target.value ? Number(event.target.value) : null
                        const template = templates.find((entry) => entry.id === templateId)
                        updateStep(template ? { ...fromTemplate(template), templateId } : { templateId })
                      }}
                      disabled={!editable}
                    >
                      <option value="">Custom content</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Checkbox label="Skip if opened" checked={step.skipIfOpened} onChange={(next) => updateStep({ skipIfOpened: next })} />
                  <Checkbox label="Skip if clicked" checked={step.skipIfClicked} onChange={(next) => updateStep({ skipIfClicked: next })} />
                  {editable ? (
                    <div className="ml-auto flex items-center gap-1">
                      <IconButton
                        label="Move up"
                        disabled={activeStep === 0 || !step.id}
                        onClick={() => {
                          if (!step.id) return
                          void run('move', () => api.campaigns.moveStep(campaign.id, step.id, 'up'), 'Step moved')
                          setActiveStep(activeStep - 1)
                        }}
                      >
                        <IconArrowUp size={14} />
                      </IconButton>
                      <IconButton
                        label="Move down"
                        disabled={activeStep === steps.length - 1 || !step.id}
                        onClick={() => {
                          if (!step.id) return
                          void run('move', () => api.campaigns.moveStep(campaign.id, step.id, 'down'), 'Step moved')
                          setActiveStep(activeStep + 1)
                        }}
                      >
                        <IconArrowDown size={14} />
                      </IconButton>
                      <IconButton
                        label="Remove step"
                        onClick={() => {
                          if (step.id) {
                            void run('remove-step', () => api.campaigns.removeStep(campaign.id, step.id), 'Step removed')
                            setDraft({ ...draft, steps: steps.filter((entry) => entry.id !== step.id) })
                            setActiveStep(Math.max(0, activeStep - 1))
                          } else {
                            setDraft({ ...draft, steps: steps.filter((_, index) => index !== activeStep) })
                            setActiveStep(Math.max(0, activeStep - 1))
                          }
                        }}
                      >
                        <IconTrash size={14} />
                      </IconButton>
                    </div>
                  ) : null}
                </div>

                <ContentEditor
                  value={step}
                  onChange={updateStep}
                  hideText={false}
                  testTarget={{ kind: 'campaign', id: campaign.id, stepId: step.id || undefined }}
                  onSave={editable ? () => void save() : undefined}
                />
              </div>
            ) : (
              <EmptyState icon={<IconTemplate size={18} />} title="No steps" body="Add an email to start writing the campaign." action={<Button size="sm" icon={<IconPlus size={13} />} onClick={() => setDraft({ ...draft, steps: [emptyStep(0)] })}>Add step</Button>} />
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'delivery' ? (
        <div className="mt-4">
          <Card>
            <CardHead title="Delivery log" subtitle="one row per email we tried to send" actions={<Button size="sm" icon={<IconRefresh size={13} />} onClick={reload} loading={loading}>Refresh</Button>} />
            <SendsTable campaignId={campaign.id} steps={steps.map((entry) => ({ id: entry.id, name: entry.name || `Email ${entry.position + 1}` }))} />
          </Card>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHead title="Identity" subtitle="how the mail appears in the inbox" />
            <div className="card-pad space-y-3">
              <Field label="Campaign name">
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!editable} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="From name">
                  <Input value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} disabled={!editable} />
                </Field>
                <Field label="From email">
                  <Input value={draft.fromEmail} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} disabled={!editable} />
                </Field>
                <Field label="Reply-to">
                  <Input value={draft.replyTo} onChange={(event) => setDraft({ ...draft, replyTo: event.target.value })} disabled={!editable} />
                </Field>
              </div>
              <Button size="sm" variant="primary" loading={busy === 'save'} disabled={!editable} onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          </Card>

          <Card>
            <CardHead title="Pacing & windows" />
            <div className="card-pad space-y-3">
              <Field label="Start at" hint="Empty means the campaign starts as soon as you press send.">
                <Input type="datetime-local" value={toLocalInput(draft.schedule.startAt)} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, startAt: fromLocalInput(event.target.value) } })} disabled={!editable} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rate / min">
                  <Input type="number" min={1} value={draft.schedule.ratePerMinute} onChange={(event) => setDraft({ ...draft, schedule: withNumber(draft.schedule, 'ratePerMinute', event.target.value) })} disabled={!editable} />
                </Field>
                <Field label="Daily cap">
                  <Input type="number" min={1} value={draft.schedule.dailyCap} onChange={(event) => setDraft({ ...draft, schedule: withNumber(draft.schedule, 'dailyCap', event.target.value) })} disabled={!editable} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Timezone">
                  <Input value={draft.schedule.timezone} onChange={(event) => setDraft({ ...draft, schedule: { ...draft.schedule, timezone: event.target.value } })} disabled={!editable} />
                </Field>
                <Field label="Send after">
                  <Select value={draft.schedule.windowStartHour ?? ''} onChange={(event) => setDraft({ ...draft, schedule: withHour(draft.schedule, 'windowStartHour', event.target.value) })} disabled={!editable}>
                    <HourOptions />
                  </Select>
                </Field>
                <Field label="Send before">
                  <Select value={draft.schedule.windowEndHour ?? ''} onChange={(event) => setDraft({ ...draft, schedule: withHour(draft.schedule, 'windowEndHour', event.target.value) })} disabled={!editable}>
                    <HourOptions />
                  </Select>
                </Field>
              </div>
              <Toggle label="Skip weekends" checked={draft.schedule.skipWeekends} onChange={(next) => setDraft({ ...draft, schedule: { ...draft.schedule, skipWeekends: next } })} disabled={!editable} />
              <p className="text-[12px] text-slate-500">
                {campaign.status === 'running' ? 'Pacing changes apply to the remaining queue on the next tick.' : 'Applied when the campaign starts.'}
              </p>
            </div>
          </Card>

          <Card>
            <CardHead title="Tracking & audience" subtitle={`${number(campaign.recipientCount)} contacts match the current filters`} />
            <div className="card-pad space-y-4">
              <Toggle label="Track opens" checked={draft.tracking.openTracking} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, openTracking: next } })} />
              <Toggle label="Track clicks" checked={draft.tracking.clickTracking} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, clickTracking: next } })} />
              <Toggle label="Append unsubscribe" checked={draft.tracking.includeUnsubscribe} onChange={(next) => setDraft({ ...draft, tracking: { ...draft.tracking, includeUnsubscribe: next } })} />
              <SegmentEditor value={draft.segment} onChange={(next) => setDraft({ ...draft, segment: next })} />
              <Button size="sm" variant="primary" loading={busy === 'save'} disabled={!editable} onClick={() => void save()}>
                Save changes
              </Button>
              {!editable ? <p className="hint">This campaign is {campaign.status} — pause it to change the audience or content.</p> : null}
            </div>
          </Card>

          <Card>
            <CardHead title="Danger zone" />
            <div className="card-pad space-y-3 text-[13px] text-slate-600">
              <p>Canceling drops every queued message. Bounces, unsubscribes and open history stay attached to the contacts.</p>
              <div className="flex flex-wrap gap-2">
                {['running', 'scheduled', 'paused'].includes(campaign.status) ? (
                  <Button size="sm" variant="danger" icon={<IconStop size={13} />} onClick={() => setConfirm('cancel')}>
                    Cancel sending
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={<IconTrash size={13} />} onClick={() => setConfirm('delete')}>
                  Delete campaign
                </Button>
              </div>
              {problems ? (
                <ul className="space-y-1 text-[12.5px] text-amber-700">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Send this campaign"
        subtitle={`${number(stats.recipients)} contacts · capped at ${number(campaign.schedule.ratePerMinute)}/min`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Not yet
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'validate'}
              onClick={() =>
                void run('validate', async () => {
                  const result = await api.campaigns.validate(campaign.id)
                  setProblems(result.ready ? [] : result.problems)
                  toast(result.ready ? 'success' : 'info', result.ready ? 'Checks passed' : 'Needs attention', result.ready ? undefined : result.problems.join(' · '))
                })
              }
            >
              Run checks
            </Button>
            <Button variant="primary" loading={busy === 'start'} onClick={() => void run('start', () => api.campaigns.start(campaign.id, at ? new Date(at).toISOString() : undefined), at ? 'Campaign scheduled' : 'Campaign started')}>
              {at ? 'Schedule' : 'Start now'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Start at" hint="Leave empty to queue everything immediately.">
            <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
          </Field>
          {problems ? (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              The engine will queue {number(stats.recipients)} messages, respecting the window ({campaign.schedule.windowStartHour ?? 0}:00–{campaign.schedule.windowEndHour ?? 24}:00) and daily cap.
            </p>
          )}
          <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
            <IconMail size={13} /> Every message carries a one-click List-Unsubscribe header, so the link below is only needed for plain-text clients.
          </p>
        </div>
      </Modal>

      <Confirm
        open={confirm !== null}
        title={confirm === 'delete' ? 'Delete this campaign?' : 'Cancel sending?'}
        body={confirm === 'delete' ? 'Steps and the delivery log are removed. Contacts and their history stay.' : 'Queued messages are dropped and the campaign is marked canceled.'}
        confirmLabel={confirm === 'delete' ? 'Delete' : 'Cancel sending'}
        danger
        busy={busy !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          void run('confirm', async () => {
            if (confirm === 'delete') {
              await api.campaigns.remove(campaign.id)
              navigate('/campaigns')
            } else {
              await api.campaigns.cancel(campaign.id)
            }
          }, confirm === 'delete' ? 'Campaign deleted' : 'Sending canceled')
        }
      />
    </div>
  )
}

const HourOptions = () => (
  <>
    <option value="">no limit</option>
    {Array.from({ length: 24 }).map((_, hour) => (
      <option key={hour} value={hour}>
        {String(hour).padStart(2, '0')}:00
      </option>
    ))}
  </>
)

function withNumber(schedule: CampaignSchedule, key: 'ratePerMinute' | 'dailyCap', raw: string): CampaignSchedule {
  return { ...schedule, [key]: Math.max(1, Math.round(Number(raw || 1))) }
}

function withHour(schedule: CampaignSchedule, key: 'windowStartHour' | 'windowEndHour', raw: string): CampaignSchedule {
  return { ...schedule, [key]: raw === '' ? null : Number(raw) }
}
