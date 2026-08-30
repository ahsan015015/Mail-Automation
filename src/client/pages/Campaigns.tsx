import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CampaignDto, CampaignStatus } from '@shared/types'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync, useDebounced } from '../lib/hooks'
import { dateTime, number, percent, relative } from '../lib/format'
import {
  Badge,
  Button,
  CampaignBadge,
  Card,
  Confirm,
  EmptyState,
  ErrorNote,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Progress,
  Segmented,
  Skeleton,
} from '../components/ui'
import { IconClock, IconCopy, IconPause, IconPlay, IconPlus, IconRefresh, IconSend, IconStop, IconTrash } from '../components/Icons'

const FILTERS = ['all', 'draft', 'scheduled', 'running', 'paused', 'completed', 'canceled'] as const
type Filter = (typeof FILTERS)[number]

export function CampaignsPage() {
  const { toast, live } = useApp()
  usePageTitle('Campaigns')
  const navigate = useNavigate()
  const [status, setStatus] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState<{ campaign: CampaignDto; action: 'cancel' | 'delete' } | null>(null)
  const [scheduleFor, setScheduleFor] = useState<CampaignDto | null>(null)
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)

  const query = useDebounced(search, 250)
  const { data, error, loading, reload } = useAsync(
    () => api.campaigns.list({ status, q: query, page, perPage: 12 }),
    [status, query, page, live.revision],
  )

  const act = async (campaign: CampaignDto, action: 'start' | 'pause' | 'resume' | 'duplicate'): Promise<void> => {
    setBusy(true)
    try {
      await api.campaigns[action](campaign.id)
      toast('success', action === 'duplicate' ? 'Campaign duplicated' : `Campaign ${action === 'start' ? 'started' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'duplicated'}`)
      reload()
      if (action === 'duplicate') {
        const list = await api.campaigns.list({ status: 'draft', perPage: 1 })
        if (list.items[0]) navigate(`/campaigns/${list.items[0].id}`)
      }
    } catch (cause) {
      toast('error', 'That did not work', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const destroy = async (): Promise<void> => {
    if (!confirm) return
    setBusy(true)
    try {
      if (confirm.action === 'cancel') await api.campaigns.cancel(confirm.campaign.id)
      else await api.campaigns.remove(confirm.campaign.id)
      toast('success', confirm.action === 'cancel' ? 'Sending canceled' : 'Campaign deleted')
      setConfirm(null)
      reload()
    } catch (cause) {
      toast('error', 'Could not change the campaign', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const schedule = async (): Promise<void> => {
    if (!scheduleFor) return
    setBusy(true)
    try {
      await api.campaigns.start(scheduleFor.id, at ? new Date(at).toISOString() : undefined)
      toast('success', at ? 'Campaign scheduled' : 'Campaign started')
      setScheduleFor(null)
      setAt('')
      reload()
    } catch (cause) {
      toast('error', 'Could not start the campaign', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Broadcasts go out once; sequences walk each contact through a series of emails."
        actions={
          <>
            <Button icon={<IconRefresh size={15} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
            <Link to="/campaigns/new" className="btn btn-primary">
              <IconPlus size={15} /> New campaign
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={status}
          onChange={(next) => {
            setStatus(next as Filter)
            setPage(1)
          }}
          options={FILTERS.map((entry) => ({ value: entry, label: entry[0]!.toUpperCase() + entry.slice(1) }))}
        />
        <div className="relative ml-auto w-full max-w-[240px]">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search campaigns…"
            className="!py-2"
          />
        </div>
      </div>

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}

      {loading && !data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<IconSend size={18} />}
            title={status === 'all' && !query ? 'No campaigns yet' : 'Nothing matches this filter'}
            body={status === 'all' && !query ? 'Start with a one-off broadcast, or build a drip sequence that follows up over days.' : undefined}
            action={
              status === 'all' && !query ? (
                <Link to="/campaigns/new" className="btn btn-primary btn-sm">
                  <IconPlus size={14} /> New campaign
                </Link>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setStatus('all')}>
                  Clear filter
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.items.map((campaign) => (
            <Card key={campaign.id} className="animate-rise flex flex-col">
              <div className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/campaigns/${campaign.id}`} className="text-[15px] font-semibold tracking-tight text-slate-900 hover:text-brand-700">
                      {campaign.name}
                    </Link>
                    <CampaignBadge status={campaign.status} />
                    <Badge tone="violet">{campaign.type === 'broadcast' ? 'broadcast' : `${campaign.steps.length}-step drip`}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[13px] text-slate-500">{campaign.subject || campaign.steps[0]?.subject || 'No subject yet'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                    <span>{campaign.fromName || campaign.fromEmail}</span>
                    <span className="text-slate-300">·</span>
                    <span>{number(campaign.recipientCount)} recipients</span>
                    {campaign.scheduledStartAt ? (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 text-sky-700">
                          <IconClock size={12} /> {dateTime(campaign.scheduledStartAt)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-auto px-4">
                <div className="flex items-center justify-between text-[12px] text-slate-500 tabular-nums">
                  <span>
                    {number(campaign.stats.sent)} sent · {number(campaign.stats.queued)} queued
                  </span>
                  <span>
                    {percent(campaign.stats.openRate)} open · {percent(campaign.stats.clickRate)} click
                  </span>
                </div>
                <Progress className="mt-1.5" value={campaign.stats.progress} tone={campaign.status === 'running' ? 'emerald' : campaign.stats.failed > 0 ? 'amber' : 'brand'} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 px-3 py-2.5">
                {canStart(campaign.status) ? (
                  <Button size="sm" variant="primary" icon={<IconPlay size={13} />} loading={busy} onClick={() => setScheduleFor(campaign)}>
                    {campaign.status === 'draft' ? 'Send' : 'Resume now'}
                  </Button>
                ) : null}
                {campaign.status === 'running' ? (
                  <Button size="sm" icon={<IconPause size={13} />} loading={busy} onClick={() => void act(campaign, 'pause')}>
                    Pause
                  </Button>
                ) : null}
                {campaign.status === 'paused' ? (
                  <Button size="sm" icon={<IconPlay size={13} />} loading={busy} onClick={() => void act(campaign, 'resume')}>
                    Resume
                  </Button>
                ) : null}
                <Link to={`/campaigns/${campaign.id}`} className="btn btn-ghost btn-sm">
                  Open
                </Link>
                <div className="ml-auto flex items-center gap-0.5">
                  <IconButton label="Duplicate" onClick={() => void act(campaign, 'duplicate')}>
                    <IconCopy size={14} />
                  </IconButton>
                  {campaign.stats.failed + campaign.stats.bounced > 0 && (campaign.status === 'running' || campaign.status === 'paused') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          const result = await api.campaigns.retryFailed(campaign.id)
                          toast('success', 'Failures requeued', `${number(result.retried)} sends will be tried again.`)
                          reload()
                        } catch (cause) {
                          toast('error', 'Retry failed', cause instanceof Error ? cause.message : undefined)
                        }
                      }}
                    >
                      Retry {number(campaign.stats.failed + campaign.stats.bounced)}
                    </Button>
                  ) : null}
                  {['running', 'scheduled', 'paused'].includes(campaign.status) ? (
                    <IconButton label="Cancel sending" onClick={() => setConfirm({ campaign, action: 'cancel' })}>
                      <IconStop size={14} />
                    </IconButton>
                  ) : null}
                  {['draft', 'canceled', 'completed'].includes(campaign.status) ? (
                    <IconButton label="Delete campaign" onClick={() => setConfirm({ campaign, action: 'delete' })}>
                      <IconTrash size={14} />
                    </IconButton>
                  ) : null}
                </div>
              </div>

              {campaign.status === 'running' && campaign.stats.nextSendAt ? (
                <p className="px-4 pb-3 text-[11.5px] text-slate-400">next message {relative(campaign.stats.nextSendAt)}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {data ? <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} /> : null}

      <Modal
        open={Boolean(scheduleFor)}
        onClose={() => setScheduleFor(null)}
        title={scheduleFor?.status === 'draft' ? 'Send this campaign' : 'Resume and schedule'}
        subtitle="Leave the time empty to start immediately."
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduleFor(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void schedule()}>
              {at ? 'Schedule' : 'Start now'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-slate-600">
          <p>
            {number(scheduleFor?.stats.recipients ?? 0)} recipients · {number(scheduleFor?.steps.length ?? 0)} step(s) · capped at{' '}
            {number(scheduleFor?.schedule.ratePerMinute ?? 0)}/min
          </p>
          <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
          <p className="hint">Scheduled campaigns flip to running on the engine tick, so a page reload never loses them.</p>
        </div>
      </Modal>

      <Confirm
        open={Boolean(confirm)}
        title={confirm?.action === 'delete' ? 'Delete this campaign?' : 'Cancel sending?'}
        body={
          confirm?.action === 'delete'
            ? 'The campaign, its steps and its delivery log are removed. Contacts and events stay.'
            : 'Queued messages are dropped and the campaign is marked canceled. Already-sent mail cannot be recalled.'
        }
        confirmLabel={confirm?.action === 'delete' ? 'Delete' : 'Cancel sending'}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void destroy()}
      />
    </div>
  )
}

const canStart = (status: CampaignStatus): boolean => status === 'draft' || status === 'paused' || status === 'scheduled'
