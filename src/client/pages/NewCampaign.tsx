import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { emptySegment, type CampaignSchedule, type CampaignTracking, type CampaignType, type StepDto, type TemplateDto } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { ContentEditor, DelayBadge, DelayPicker, emptyStep, fromTemplate } from '../components/Editor'
import { SegmentEditor } from '../components/SegmentEditor'
import { number } from '../lib/format'
import { Badge, Button, Card, CardHead, Checkbox, Field, Input, PageHeader, Segmented, Select, Tabs, Toggle } from '../components/ui'
import { IconArrowDown, IconArrowUp, IconCheck, IconPlus, IconTemplate, IconTrash, IconWarn } from '../components/Icons'

const STEPS = [
  { value: 'audience', label: 'Audience' },
  { value: 'content', label: 'Content' },
  { value: 'sending', label: 'Sending' },
] as const
type Tab = (typeof STEPS)[number]['value']

export function NewCampaignPage() {
  const { toast, refresh } = useApp()
  usePageTitle('New campaign')
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('audience')
  const [type, setType] = useState<CampaignType>('broadcast')
  const [name, setName] = useState('')
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [segment, setSegment] = useState(emptySegment())
  const [steps, setSteps] = useState<StepDto[]>([emptyStep(0)])
  const [activeStep, setActiveStep] = useState(0)
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [schedule, setSchedule] = useState<CampaignSchedule>({
    startAt: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    windowStartHour: 8,
    windowEndHour: 21,
    ratePerMinute: 30,
    dailyCap: 2000,
    skipWeekends: false,
  })
  const [tracking, setTracking] = useState<CampaignTracking>({ openTracking: true, clickTracking: true, includeUnsubscribe: true })
  const [recipients, setRecipients] = useState<number | null>(null)
  const [saving, setSaving] = useState<'draft' | 'start' | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settings, list] = await Promise.all([api.settings.get(), api.templates.list().catch(() => null)])
      if (cancelled) return
      setFromName(settings.fromName)
      setFromEmail(settings.fromEmail)
      setReplyTo(settings.replyTo)
      setSchedule((current) => ({
        ...current,
        ratePerMinute: settings.sending.ratePerMinute,
        dailyCap: settings.sending.dailyCap,
        timezone: settings.sending.timezone,
        windowStartHour: settings.sending.windowStartHour,
        windowEndHour: settings.sending.windowEndHour,
      }))
      setTracking(settings.tracking)
      setTemplates(list?.items ?? [])
    })().catch((cause: Error) => toast('error', 'Could not load defaults', cause.message))
    return () => {
      cancelled = true
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api.campaigns
        .estimate(segment)
        .then((result) => !cancelled && setRecipients(result.recipients))
        .catch(() => !cancelled && setRecipients(null))
    }, 240)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [segment])

  const step = steps[activeStep] ?? steps[0]
  const updateStep = (patch: Partial<StepDto>): void => {
    setSteps((current) => current.map((entry, index) => (index === activeStep ? { ...entry, ...patch } : entry)))
  }

  const problems = useMemo(() => {
    const list: string[] = []
    if (!name.trim()) list.push('Give the campaign a name')
    if (!fromEmail.includes('@')) list.push('A “from” email address is required')
    if (!segment.listIds.length && !segment.tagIds.length) list.push('Pick at least one list or tag so we know who to send to')
    steps.forEach((entry, index) => {
      if (!entry.subject.trim()) list.push(`Step ${index + 1} has no subject line`)
      if (!entry.html.trim()) list.push(`Step ${index + 1} has no body`)
    })
    return list
  }, [name, fromEmail, segment, steps])

  const save = async (mode: 'draft' | 'start'): Promise<void> => {
    setErrors(mode === 'start' ? problems : [])
    if (mode === 'start' && problems.length) {
      setTab(problems.some((problem) => problem.includes('subject') || problem.includes('body')) ? 'content' : 'audience')
      return
    }
    setSaving(mode)
    try {
      const campaign = await api.campaigns.create({
        name: name.trim() || 'Untitled campaign',
        type,
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        replyTo: replyTo.trim(),
        segment,
        schedule,
        tracking,
        steps: steps.map((entry, index) => ({ ...entry, position: index, id: undefined })),
      })
      if (mode === 'start') await api.campaigns.start(campaign.id)
      await refresh()
      toast('success', mode === 'start' ? 'Campaign started' : 'Draft saved', mode === 'start' ? `${number(recipients ?? 0)} contacts queued.` : undefined)
      navigate(`/campaigns/${campaign.id}`)
    } catch (cause) {
      const error = cause as { message?: string; issues?: { path: string; message: string }[] }
      setErrors([error?.message ?? 'Could not save the campaign', ...(error?.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`)])
      toast('error', 'Could not save', error?.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="New campaign"
        subtitle={<Link to="/campaigns" className="text-brand-700 hover:underline">Back to campaigns</Link>}
        actions={
          <>
            <Button loading={saving === 'draft'} onClick={() => void save('draft')}>
              Save draft
            </Button>
            <Button variant="primary" icon={<IconCheck size={15} />} loading={saving === 'start'} onClick={() => void save('start')}>
              Save &amp; start
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 px-4 py-3">
              <Segmented
                value={type}
                onChange={(next) => {
                  const campaignType = next as CampaignType
                  setType(campaignType)
                  if (campaignType === 'broadcast') setSteps((current) => current.slice(0, 1))
                }}
                options={[
                  { value: 'broadcast', label: 'Broadcast' },
                  { value: 'sequence', label: 'Drip sequence' },
                ]}
              />
              <span className="text-[12.5px] text-slate-500">
                {type === 'broadcast' ? 'One email, everyone, now or at a chosen time.' : 'A series with delays between each email per contact.'}
              </span>
            </div>
            <div className="px-4 pt-3">
              <Tabs tabs={STEPS.map((entry) => ({ value: entry.value, label: entry.label }))} value={tab} onChange={setTab} />
            </div>

            {tab === 'audience' ? (
              <div className="card-pad space-y-5">
                <Field label="Campaign name" required hint="Only you see this — it is used in reports and the footer of tracked links.">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="March newsletter" autoFocus />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="From name">
                    <Input value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Acme" />
                  </Field>
                  <Field label="From email" required>
                    <Input value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} placeholder="hello@acme.dev" />
                  </Field>
                  <Field label="Reply-to" hint="Optional">
                    <Input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="support@acme.dev" />
                  </Field>
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <SegmentEditor value={segment} onChange={setSegment} />
                </div>
              </div>
            ) : null}

            {tab === 'content' ? (
              <div>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-4 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {steps.map((entry, index) => (
                      <button
                        key={`${entry.name}-${index}`}
                        type="button"
                        onClick={() => setActiveStep(index)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                          index === activeStep ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {index + 1}. {entry.name || `Email ${index + 1}`}
                        {type === 'sequence' ? <DelayBadge minutes={entry.delayMinutes} /> : null}
                      </button>
                    ))}
                  </div>
                  {type === 'sequence' ? (
                    <Button size="sm" variant="ghost" icon={<IconPlus size={13} />} onClick={() => setSteps((current) => [...current, emptyStep(current.length)])}>
                      Add step
                    </Button>
                  ) : null}
                </div>

                {step ? (
                  <div className="card-pad space-y-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Step name" className="min-w-[180px] flex-1">
                          <Input value={step.name} onChange={(event) => updateStep({ name: event.target.value })} placeholder={`Email ${activeStep + 1}`} />
                        </Field>
                        {type === 'sequence' ? (
                          <Field label={activeStep === 0 ? 'Wait before step 1' : 'Wait after previous step'}>
                            <div className="flex items-center gap-2">
                              <DelayPicker minutes={step.delayMinutes} onChange={(minutes) => setSteps((current) => current.map((entry, index) => (index === activeStep ? { ...entry, delayMinutes: minutes } : entry)))} />
                            </div>
                          </Field>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {type === 'sequence' && steps.length > 1 ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<IconArrowUp size={13} />}
                              onClick={() =>
                                setSteps((current) => {
                                  const next = [...current]
                                  const [moved] = next.splice(activeStep, 1)
                                  next.splice(Math.max(0, activeStep - 1), 0, moved!)
                                  setActiveStep(Math.max(0, activeStep - 1))
                                  return next
                                })
                              }
                            >
                              <span className="sr-only">Move up</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<IconArrowDown size={13} />}
                              onClick={() =>
                                setSteps((current) => {
                                  const next = [...current]
                                  const [moved] = next.splice(activeStep, 1)
                                  next.splice(Math.min(next.length, activeStep + 1), 0, moved!)
                                  setActiveStep(Math.min(next.length - 1, activeStep + 1))
                                  return next
                                })
                              }
                            >
                              <span className="sr-only">Move down</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<IconTrash size={13} />}
                              onClick={() => {
                                setSteps((current) => current.filter((_, index) => index !== activeStep))
                                setActiveStep(Math.max(0, activeStep - 1))
                              }}
                            >
                              <span className="sr-only">Delete step</span>
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] text-slate-500">Start from a template</span>
                      <Select
                        className="!w-auto !py-1.5 text-[12.5px]"
                        value={step.templateId ?? ''}
                        onChange={(event) => {
                          const id = event.target.value ? Number(event.target.value) : null
                          const template = templates.find((entry) => entry.id === id)
                          setSteps((current) =>
                            current.map((entry, index) => (index === activeStep ? { ...entry, ...(template ? fromTemplate(template) : {}), templateId: id } : entry)),
                          )
                        }}
                      >
                        <option value="">Blank</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </Select>
                      {templates.length ? (
                        <Link to="/templates" className="inline-flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-brand-700">
                          <IconTemplate size={13} /> manage templates
                        </Link>
                      ) : (
                        <Link to="/templates" className="inline-flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-brand-700">
                          <IconTemplate size={13} /> create a template
                        </Link>
                      )}
                      <div className="ml-auto flex items-center gap-3">
                        <Checkbox label="Skip if opened" checked={step.skipIfOpened} onChange={(next) => setSteps((current) => current.map((entry, index) => (index === activeStep ? { ...entry, skipIfOpened: next } : entry)))} />
                        <Checkbox label="Skip if clicked" checked={step.skipIfClicked} onChange={(next) => setSteps((current) => current.map((entry, index) => (index === activeStep ? { ...entry, skipIfClicked: next } : entry)))} />
                      </div>
                    </div>

                    <ContentEditor value={step} onChange={updateStep} hideText={false} />
                  </div>
                ) : (
                  <div className="card-pad text-center">
                    <p className="text-[13px] text-slate-500">No steps yet.</p>
                    <Button size="sm" className="mt-2" icon={<IconPlus size={13} />} onClick={() => setSteps([emptyStep(0)])}>
                      Add the first step
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'sending' ? (
              <div className="card-pad grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Pacing</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rate (per minute)" hint="Shared with other running campaigns">
                      <Input type="number" min={1} max={6000} value={schedule.ratePerMinute} onChange={(event) => setSchedule({ ...schedule, ratePerMinute: Number(event.target.value || 1) })} />
                    </Field>
                    <Field label="Daily cap">
                      <Input type="number" min={1} value={schedule.dailyCap} onChange={(event) => setSchedule({ ...schedule, dailyCap: Number(event.target.value || 1) })} />
                    </Field>
                  </div>
                  <Field label="Timezone">
                    <Input value={schedule.timezone} onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Send after (hour)" hint="24h local clock">
                      <Select value={schedule.windowStartHour ?? ''} onChange={(event) => setSchedule({ ...schedule, windowStartHour: event.target.value === '' ? null : Number(event.target.value) })}>
                        <option value="">no limit</option>
                        {Array.from({ length: 24 }).map((_, hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, '0')}:00
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Send before (hour)">
                      <Select value={schedule.windowEndHour ?? ''} onChange={(event) => setSchedule({ ...schedule, windowEndHour: event.target.value === '' ? null : Number(event.target.value) })}>
                        <option value="">no limit</option>
                        {Array.from({ length: 24 }).map((_, hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, '0')}:00
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Toggle label="Skip weekends" checked={schedule.skipWeekends} onChange={(next) => setSchedule({ ...schedule, skipWeekends: next })} hint="Messages wait until Monday." />
                </div>

                <div className="space-y-3">
                  <p className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Tracking</p>
                  <Toggle label="Track opens" checked={tracking.openTracking} onChange={(next) => setTracking({ ...tracking, openTracking: next })} hint="Adds an invisible 1×1 pixel." />
                  <Toggle label="Track clicks" checked={tracking.clickTracking} onChange={(next) => setTracking({ ...tracking, clickTracking: next })} hint="Links redirect through /t/c so clicks are attributed." />
                  <Toggle label="Append unsubscribe link" checked={tracking.includeUnsubscribe} onChange={(next) => setTracking({ ...tracking, includeUnsubscribe: next })} hint="Required for bulk sending; always adds List-Unsubscribe headers." />
                  <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
                    <p className="font-medium text-slate-700">How sending works</p>
                    <p className="mt-1">
                      Starting a campaign only queues messages. The engine drains the queue on its tick, respects caps and windows, retries transient failures with
                      exponential backoff and marks hard bounces as suppressed.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardHead title="Ready to send?" subtitle={problems.length ? `${problems.length} thing(s) left` : 'all good'} />
            <div className="card-pad space-y-2">
              {problems.length ? (
                problems.map((problem) => (
                  <p key={problem} className="flex items-start gap-2 text-[12.5px] text-amber-700">
                    <IconWarn size={14} className="mt-0.5 shrink-0" /> {problem}
                  </p>
                ))
              ) : (
                <p className="flex items-center gap-2 text-[12.5px] text-emerald-700">
                  <IconCheck size={14} /> Everything looks good.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Summary" />
            <dl className="card-pad space-y-2 text-[13px]">
              {[
                ['Type', type === 'broadcast' ? 'Broadcast' : 'Drip sequence'],
                ['Steps', number(steps.length)],
                ['Recipients', recipients === null ? '…' : number(recipients)],
                ['First delay', type === 'sequence' && steps[0]?.delayMinutes ? `${steps[0].delayMinutes} min` : 'immediately'],
                ['Rate', `${number(schedule.ratePerMinute)}/min`],
                ['Daily cap', number(schedule.dailyCap)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-800 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {recipients !== null && recipients > 0 ? (
              <div className="px-4 pb-4">
                <Badge tone="brand">
                  ≈ {Math.max(1, Math.ceil(recipients / Math.max(1, schedule.ratePerMinute)))} min of sending
                </Badge>
              </div>
            ) : null}
          </Card>

          {errors.length ? (
            <Card>
              <div className="card-pad space-y-1.5">
                {errors.map((message) => (
                  <p key={message} className="text-[12.5px] text-rose-700">
                    {message}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
