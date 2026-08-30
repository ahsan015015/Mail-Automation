import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, usePageTitle } from '../App'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { number, percent, plural, relative } from '../lib/format'
import {
  Badge,
  Button,
  CampaignBadge,
  Card,
  CardHead,
  EmptyState,
  ErrorNote,
  Kpi,
  PageHeader,
  Progress,
  Skeleton,
} from '../components/ui'
import { ActivityChart, ChartLegend, FunnelBars, GrowthChart } from '../components/Charts'
import {
  IconClick,
  IconEye,
  IconGauge,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSend,
  IconUsers,
  IconWarn,
} from '../components/Icons'

export function DashboardPage() {
  const { live, toast, refresh } = useApp()
  usePageTitle('Dashboard')
  const [busy, setBusy] = useState<'tick' | 'drain' | null>(null)

  const { data, error, loading, reload } = useAsync(async () => {
    const [dash, growth] = await Promise.all([api.stats.dashboard(), api.stats.growth(30)])
    const featured = dash.topCampaigns[0] ?? null
    const stats = featured ? await api.campaigns.stats(featured.id).catch(() => null) : null
    const engine = await api.engine.status().catch(() => null)
    return { dash, growth, featured, stats, engine }
  }, [live.revision])

  const runEngine = async (action: 'tick' | 'drain'): Promise<void> => {
    setBusy(action)
    try {
      const result = action === 'tick' ? await api.engine.tick() : await api.engine.drain(80)
      toast(result.sent ? 'success' : 'info', action === 'tick' ? 'Tick finished' : 'Outbox processed', `${number(result.sent)} sent, ${number(result.failed)} failed, ${number(result.skipped)} skipped${result.sent ? '' : ' — nothing is due yet'}.`)
      reload()
    } catch (cause) {
      toast('error', 'Engine command failed', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const quickAction = async (id: number, action: 'start' | 'pause' | 'resume'): Promise<void> => {
    try {
      await api.campaigns[action](id)
      await refresh()
      reload()
    } catch (cause) {
      toast('error', 'Could not change campaign state', cause instanceof Error ? cause.message : undefined)
    }
  }

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Loading workspace…" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      </div>
    )
  }

  const totals = data?.dash.totals ?? null
  const engine = data?.engine ?? null

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={live.connected ? 'emerald' : 'slate'} dot>
              {live.connected ? 'live' : 'offline'}
            </Badge>
            <span>
              {totals
                ? `${number(totals.subscribed)} subscribed · ${plural(totals.campaignsRunning, 'campaign')} running · ${number(totals.queued)} in the outbox`
                : 'Loading…'}
            </span>
          </span>
        }
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

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}

      <div className="mt-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Subscribed" value={number(totals?.subscribed)} sub={`${number(totals?.contacts)} contacts on file`} icon={<IconUsers size={14} />} tone="brand" />
        <Kpi label="Sent today" value={number(totals?.sentToday)} sub={`${number(totals?.sent)} all time`} icon={<IconSend size={14} />} />
        <Kpi label="In outbox" value={number(totals?.queued)} sub={engine?.running ? `engine ticking every ${Math.round((engine.tickMs ?? 1000) / 1000)}s` : 'engine paused'} icon={<IconMail size={14} />} tone={totals && totals.queued > 0 ? 'amber' : 'slate'} />
        <Kpi label="Open rate" value={percent(totals?.openRate)} sub={`${number(totals?.opens)} opens`} icon={<IconEye size={14} />} tone="sky" />
        <Kpi label="Click rate" value={percent(totals?.clickRate)} sub={`${number(totals?.clicks)} clicks`} icon={<IconClick size={14} />} tone="emerald" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead title="Last 24 hours" subtitle="Sends, opens and clicks per hour" icon={<IconGauge size={16} />} actions={<ChartLegend />} />
          <div className="p-4">
            <ActivityChart points={data?.dash.series ?? []} height={150} />
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-slate-200/70 bg-slate-200/70 sm:grid-cols-4">
            {[
              { label: 'Sent', value: (data?.dash.series ?? []).reduce((sum, row) => sum + row.sent, 0) },
              { label: 'Opens', value: (data?.dash.series ?? []).reduce((sum, row) => sum + row.opens, 0) },
              { label: 'Clicks', value: (data?.dash.series ?? []).reduce((sum, row) => sum + row.clicks, 0) },
              { label: 'Bounced', value: totals?.bounced ?? 0 },
            ].map((item) => (
              <div key={item.label} className="bg-white px-4 py-3">
                <p className="text-[11.5px] font-medium tracking-wide text-slate-500 uppercase">{item.label}</p>
                <p className="mt-1 text-[18px] font-semibold text-slate-900 tabular-nums">{number(item.value)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Delivery engine"
            subtitle={engine ? `${engine.transport} transport` : '…'}
            icon={<IconMail size={16} />}
            actions={
              <Badge tone={engine?.running ? 'emerald' : 'amber'} dot>
                {engine?.running ? 'running' : 'paused'}
              </Badge>
            }
          />
          <div className="card-pad">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Queued', value: engine?.queueDepth ?? 0 },
                { label: 'Sent (up)', value: engine?.lifetime.sent ?? 0 },
                { label: 'Failed (up)', value: engine?.lifetime.failed ?? 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200/70 px-2.5 py-2">
                  <p className="text-[11px] text-slate-500">{item.label}</p>
                  <p className="text-[17px] font-semibold tabular-nums">{number(item.value)}</p>
                </div>
              ))}
            </div>
            <dl className="mt-4 space-y-2 text-[13px]">
              {[
                ['Last tick', engine?.lastTickAt ? `${relative(engine.lastTickAt)} (${engine.tickDurationMs ?? 0}ms)` : 'never'],
                ['Rate cap', `${number(engine?.limits.ratePerMinute)} / min`],
                ['Daily cap', `${number(engine?.limits.dailyCap)} / day`],
                ['Retries', `${engine?.limits.maxAttempts} attempts`],
                ['Active campaigns', number(data?.dash.engine.activeCampaigns)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-medium text-slate-800 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" icon={<IconRefresh size={14} />} loading={busy === 'tick'} onClick={() => void runEngine('tick')}>
                Run a tick
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'drain'} onClick={() => void runEngine('drain')} disabled={!engine?.queueDepth} title="Sends every message that is due right now — delayed drip steps keep waiting">
                Send what&apos;s due
              </Button>
              <Link to="/settings" className="btn btn-ghost btn-sm">
                Settings
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead
            title="Top campaigns"
            subtitle={data?.dash.totals.campaignsScheduled ? `${number(data.dash.totals.campaignsScheduled)} scheduled` : 'by delivery volume'}
            icon={<IconSend size={16} />}
            actions={
              <Link to="/campaigns" className="text-[13px] font-medium text-brand-700 hover:underline">
                All campaigns
              </Link>
            }
          />
          {!data?.dash.topCampaigns.length ? (
            <EmptyState
              icon={<IconSend size={18} />}
              title="No campaigns yet"
              body="Create a broadcast or a drip sequence and start it — progress shows up here within seconds."
              action={
                <Link to="/campaigns/new" className="btn btn-primary btn-sm">
                  <IconPlus size={14} /> New campaign
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.dash.topCampaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/campaigns/${campaign.id}`} className="truncate text-[14px] font-medium text-slate-900 hover:text-brand-700">
                        {campaign.name}
                      </Link>
                      <CampaignBadge status={campaign.status} />
                    </div>
                    <p className="mt-1 text-[12px] text-slate-500 tabular-nums">
                      {number(campaign.sent)} / {number(campaign.recipients)} sent · {percent(campaign.openRate)} open · {percent(campaign.clickRate)} click
                    </p>
                    <Progress className="mt-2" value={campaign.recipients ? (campaign.sent / campaign.recipients) * 100 : 0} tone={campaign.status === 'running' ? 'emerald' : 'brand'} />
                  </div>
                  {campaign.status === 'running' ? (
                    <Button size="sm" variant="ghost" onClick={() => void quickAction(campaign.id, 'pause')}>
                      Pause
                    </Button>
                  ) : campaign.status === 'paused' ? (
                    <Button size="sm" variant="ghost" onClick={() => void quickAction(campaign.id, 'resume')}>
                      Resume
                    </Button>
                  ) : campaign.status === 'draft' ? (
                    <Button size="sm" variant="ghost" onClick={() => void quickAction(campaign.id, 'start')}>
                      Start
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Funnel" subtitle={data?.featured ? data.featured.name : 'per-campaign breakdown'} icon={<IconEye size={16} />} />
          {!data?.featured || !data.stats ? (
            <EmptyState title="Nothing measured yet" body="Funnel numbers appear once a campaign has delivered messages." />
          ) : (
            <div className="card-pad space-y-4">
              <FunnelBars points={data.stats.funnel} />
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[12.5px]">
                <span className="text-slate-500">Progress</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {number(data.stats.stats.sent)} of {number(data.stats.stats.recipients)} · next send{' '}
                  {data.stats.stats.nextSendAt ? relative(data.stats.stats.nextSendAt) : '—'}
                </span>
              </div>
              {data.stats.stats.bounced + data.stats.stats.failed > 0 ? (
                <Link to={`/campaigns/${data.featured.id}`} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 hover:bg-amber-100">
                  <IconWarn size={14} /> {number(data.stats.stats.bounced)} bounced, {number(data.stats.stats.failed)} failed — review
                </Link>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead
            title="List growth"
            subtitle="added vs unsubscribed, 30 days"
            icon={<IconUsers size={16} />}
            actions={
              <Link to="/contacts" className="text-[13px] font-medium text-brand-700 hover:underline">
                Manage contacts
              </Link>
            }
          />
          <div className="p-4">
            <GrowthChart points={data?.growth.points ?? []} />
          </div>
        </Card>

        <Card>
          <CardHead title="Latest activity" subtitle={live.connected ? 'streaming over SSE' : 'manual refresh'} icon={<IconClick size={16} />} />
          {!data?.dash.recentEvents.length ? (
            <EmptyState title="No events yet" body="Opens, clicks, bounces and unsubscribes land here as they happen." />
          ) : (
            <ul className="scroll-thin max-h-[330px] divide-y divide-slate-100 overflow-y-auto">
              {data.dash.recentEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500">
                    <EventGlyph kind={event.kind} />
                  </span>
                  <span className="font-medium text-slate-700">{event.kind.replace('.', ' ')}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{event.message}</span>
                  <span className="shrink-0 text-[12px] text-slate-400 tabular-nums">{relative(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function EventGlyph({ kind }: { kind: string }) {
  if (kind.includes('open')) return <IconEye size={13} />
  if (kind.includes('click')) return <IconClick size={13} />
  if (kind.includes('unsub') || kind.includes('subscrib')) return <IconUsers size={13} />
  if (kind.includes('fail') || kind.includes('bounce')) return <IconWarn size={13} />
  return <IconSend size={13} />
}
