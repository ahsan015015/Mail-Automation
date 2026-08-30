import { useEffect, useState } from 'react'
import type { Paged, SendDto } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from '../App'
import { dateTime, relative } from '../lib/format'
import { Badge, Button, EmptyState, Pagination, Segmented, SendBadge, Skeleton } from './ui'
import { IconClick, IconEye, IconRefresh, IconSend } from './Icons'

const STATUSES = ['all', 'queued', 'sending', 'sent', 'skipped', 'bounced', 'failed'] as const

/** Delivery log for a campaign: one row per (step, contact) with tracking counters. */
export function SendsTable({ campaignId, steps = [] }: { campaignId: number; steps?: { id: number; name: string }[] }) {
  const { live, toast } = useApp()
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [stepId, setStepId] = useState<number | undefined>()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Paged<SendDto> | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.campaigns
      .sends(campaignId, { status, stepId, page, perPage: 25 })
      .then((result) => !cancelled && setData(result))
      .catch((error: Error) => !cancelled && toast('error', 'Could not load the delivery log', error.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [campaignId, status, stepId, page, nonce, live.revision, toast])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-1 pb-3">
        <Segmented
          size="sm"
          value={status}
          onChange={(next) => {
            setStatus(next)
            setPage(1)
          }}
          options={STATUSES.map((entry) => ({ value: entry, label: entry }))}
        />
        {steps.length > 1 ? (
          <select
            className="field !w-auto !py-1.5 text-[12.5px]"
            value={stepId ?? ''}
            onChange={(event) => {
              setStepId(event.target.value ? Number(event.target.value) : undefined)
              setPage(1)
            }}
          >
            <option value="">all steps</option>
            {steps.map((step) => (
              <option key={step.id} value={step.id}>
                {step.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button size="sm" variant="ghost" icon={<IconRefresh size={14} />} onClick={() => setNonce((value) => value + 1)}>
          Refresh
        </Button>
        <span className="ml-auto text-[12px] text-slate-500">{data ? `${data.total} rows` : ''}</span>
      </div>

      {loading && !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
      ) : !data || !data.items.length ? (
        <EmptyState icon={<IconSend size={18} />} title="No messages here yet" body="Nothing matches this filter — queued messages appear as soon as the campaign starts." />
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Recipient</th>
                <th className="hidden sm:table-cell">Step</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Scheduled</th>
                <th className="hidden md:table-cell">Sent</th>
                <th className="text-right">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((send) => (
                <tr key={send.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="max-w-[220px] truncate font-medium text-slate-800">{send.contactEmail}</span>
                      {send.attempts > 1 ? <Badge tone="amber">{send.attempts} tries</Badge> : null}
                    </div>
                    {send.error ? <p className="mt-0.5 max-w-[320px] truncate text-[11.5px] text-rose-600">{send.error}</p> : null}
                  </td>
                  <td className="hidden text-slate-500 sm:table-cell">{send.stepName ?? '—'}</td>
                  <td>
                    <SendBadge status={send.status} />
                  </td>
                  <td className="hidden text-slate-500 md:table-cell" title={send.sendAfter}>
                    {relative(send.sendAfter)}
                  </td>
                  <td className="hidden text-slate-500 md:table-cell">{send.sentAt ? dateTime(send.sentAt) : '—'}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-2.5 text-[12.5px] tabular-nums">
                      <span className={`inline-flex items-center gap-1 ${send.openCount ? 'text-sky-600' : 'text-slate-300'}`}>
                        <IconEye size={13} /> {send.openCount}
                      </span>
                      <span className={`inline-flex items-center gap-1 ${send.clickCount ? 'text-emerald-600' : 'text-slate-300'}`}>
                        <IconClick size={13} /> {send.clickCount}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data ? <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} /> : null}
    </div>
  )
}
