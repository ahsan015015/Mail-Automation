import { useEffect, useState } from 'react'
import { emptySegment, type ListDto, type Segment, type TagDto } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from '../App'
import { Badge, Button, Field, Select } from './ui'
import { number } from '../lib/format'
import { IconUsers } from './Icons'

/** Audience builder: lists + tags (any/all) minus exclusions, with a live count. */
export function SegmentEditor({ value, onChange }: { value: Segment; onChange: (next: Segment) => void }) {
  const { toast, live } = useApp()
  const [lists, setLists] = useState<ListDto[]>([])
  const [tags, setTags] = useState<TagDto[]>([])
  const [estimate, setEstimate] = useState<{ recipients: number; sample: { id: number; email: string; name: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [listResult, tagResult] = await Promise.all([api.lists.list(true), api.tags.list()])
      if (cancelled) return
      setLists(listResult.items)
      setTags(tagResult.items)
    })().catch((error: Error) => toast('error', 'Could not load audience data', error.message))
    return () => {
      cancelled = true
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(() => {
      api.campaigns
        .estimate(value)
        .then((result) => !cancelled && setEstimate(result))
        .catch((error: Error) => !cancelled && toast('error', 'Estimate failed', error.message))
        .finally(() => !cancelled && setBusy(false))
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [JSON.stringify(value), live.revision, toast])

  const toggle = (key: keyof Segment, id: number): void => {
    const current = (value[key] as number[]) ?? []
    onChange({ ...value, [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] } as Segment)
  }

  const Chips = ({ items, selectedKey, empty }: { items: { id: number; name: string; count?: number; color?: string }[]; selectedKey: keyof Segment; empty: string }) => {
    const selected = (value[selectedKey] as number[]) ?? []
    if (!items.length) return <p className="text-[12.5px] text-slate-400">{empty}</p>
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const active = selected.includes(item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(selectedKey, item.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition ${
                active ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {item.color ? <span className="size-2 rounded-full" style={{ background: item.color }} /> : null}
              {item.name}
              {item.count !== undefined ? <span className="text-[11px] text-slate-400 tabular-nums">{item.count}</span> : null}
              {active ? <span className="text-brand-600">✓</span> : null}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
          <IconUsers size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-slate-500">Estimated recipients</p>
          <p className="text-[17px] leading-tight font-semibold text-slate-900 tabular-nums">{busy && !estimate ? '…' : number(estimate?.recipients ?? 0)}</p>
        </div>
        {estimate && estimate.recipients === 0 ? <Badge tone="amber">nothing matches these filters</Badge> : null}
        {estimate && estimate.sample.length ? (
          <div className="hidden text-right text-[11.5px] text-slate-500 sm:block">
            e.g.{' '}
            {estimate.sample.slice(0, 2).map((contact) => (
              <span key={contact.id} className="font-mono">
                {contact.email}{' '}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <Field label="Include contacts on these lists" hint="Nothing selected = every list">
        <Chips items={lists.map((list) => ({ id: list.id, name: list.name, count: list.subscribedCount }))} selectedKey="listIds" empty="No lists yet — create one first." />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="With tags"
          hint={
            <span className="flex items-center gap-2">
              match
              <Select className="!w-24 !py-1 text-[12px]" value={value.tagMatch} onChange={(event) => onChange({ ...value, tagMatch: event.target.value as 'any' | 'all' })}>
                <option value="any">any</option>
                <option value="all">all</option>
              </Select>
            </span>
          }
        >
          <Chips items={tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag.contactCount, color: tag.color }))} selectedKey="tagIds" empty="No tags yet." />
        </Field>

        <Field label="Statuses" hint="Only subscribed contacts receive email by default">
          <div className="flex flex-wrap gap-1.5">
            {(['subscribed', 'unsubscribed', 'bounced', 'complained', 'pending'] as const).map((status) => {
              const active = value.statuses.includes(status)
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() =>
                    onChange({ ...value, statuses: active ? value.statuses.filter((entry) => entry !== status) : [...value.statuses, status] })
                  }
                  className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium capitalize transition ${
                    active ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {status}
                </button>
              )
            })}
          </div>
        </Field>
      </div>

      <details className="rounded-lg border border-slate-200 px-3 py-2" open={value.excludeListIds.length > 0 || value.excludeTagIds.length > 0}>
        <summary className="cursor-pointer text-[12.5px] font-medium text-slate-600">
          Exclusions {value.excludeListIds.length + value.excludeTagIds.length > 0 ? <Badge tone="rose">{value.excludeListIds.length + value.excludeTagIds.length} active</Badge> : null}
        </summary>
        <div className="mt-3 space-y-3">
          <Field label="Except these lists">
            <Chips items={lists.map((list) => ({ id: list.id, name: list.name, count: list.subscribedCount }))} selectedKey="excludeListIds" empty="No lists yet." />
          </Field>
          <Field label="Except these tags">
            <Chips items={tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag.contactCount, color: tag.color }))} selectedKey="excludeTagIds" empty="No tags yet." />
          </Field>
        </div>
      </details>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...emptySegment(), tagMatch: 'any' })}>
          Clear filters
        </Button>
        {lists[0] ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...emptySegment(), listIds: [lists[0].id] })}>
            First list only
          </Button>
        ) : null}
      </div>
    </div>
  )
}
