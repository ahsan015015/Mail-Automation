import type { FunnelPoint } from '@shared/types'

/* Dependency-free SVG charts, sized with viewBox so they are fully responsive. */

const HOURLY_PALETTE = { sent: '#4f46e5', opens: '#0ea5e9', clicks: '#10b981' } as const

export function ActivityChart({ points, height = 132 }: { points: { hour: string; sent: number; opens: number; clicks: number }[]; height?: number }) {
  const width = Math.max(240, points.length * 26)
  const max = Math.max(1, ...points.flatMap((point) => [point.sent, point.opens, point.clicks]))
  const groupWidth = width / Math.max(1, points.length)
  const barWidth = Math.max(3, groupWidth / 3.6)
  const scaleY = (value: number) => (value / max) * (height - 18)

  return (
    <div className="overflow-x-auto no-scrollbar">
      <svg viewBox={`0 0 ${width} ${height + 18}`} width="100%" height={height + 18} role="img" aria-label="Hourly sending activity" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line key={fraction} x1={0} x2={width} y1={height - fraction * (height - 18)} y2={height - fraction * (height - 18)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={fraction === 1 ? '' : '3 4'} />
        ))}
        {points.map((point, index) => {
          const left = index * groupWidth + groupWidth / 2 - (barWidth * 1.5 + 1.5)
          const entries: ('sent' | 'opens' | 'clicks')[] = ['sent', 'opens', 'clicks']
          return (
            <g key={point.hour}>
              {entries.map((key, barIndex) => {
                const value = point[key]
                const barHeight = scaleY(value)
                return (
                  <rect
                    key={key}
                    x={left + barIndex * (barWidth + 1.5)}
                    y={height - barHeight}
                    width={barWidth}
                    height={Math.max(value > 0 ? 1.5 : 0, barHeight)}
                    rx={1.5}
                    fill={HOURLY_PALETTE[key]}
                    opacity={key === 'sent' ? 1 : 0.9}
                  >
                    <title>{`${point.hour}:00 · ${key} ${value}`}</title>
                  </rect>
                )
              })}
              {index % Math.ceil(points.length / 8) === 0 ? (
                <text x={index * groupWidth + groupWidth / 2} y={height + 13} textAnchor="middle" fontSize={9.5} fill="#94a3b8">
                  {point.hour.slice(11, 13)}h
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function ChartLegend({ items = ['sent', 'opens', 'clicks'] }: { items?: (keyof typeof HOURLY_PALETTE)[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-slate-500">
      {items.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px]" style={{ background: HOURLY_PALETTE[key] }} />
          {key}
        </span>
      ))}
    </div>
  )
}

export function FunnelBars({ points }: { points: FunnelPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.value))
  const colors = ['#4f46e5', '#6366f1', '#0ea5e9', '#10b981']
  return (
    <ol className="space-y-2.5">
      {points.map((point, index) => (
        <li key={point.label} className="grid grid-cols-[84px_1fr_auto] items-center gap-3">
          <span className="text-[12.5px] font-medium text-slate-600">{point.label}</span>
          <span className="relative block h-6 overflow-hidden rounded-md bg-slate-100">
            <span
              className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
              style={{ width: `${Math.max(point.value > 0 ? 4 : 0, (point.value / max) * 100)}%`, background: colors[index % colors.length] }}
            />
          </span>
          <span className="text-right text-[12.5px] tabular-nums">
            <span className="font-semibold text-slate-800">{point.value.toLocaleString()}</span>
            <span className="ml-1.5 text-slate-500">{point.percent}%</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function Sparkline({ values, tone = '#4f46e5', height = 34, area = true }: { values: number[]; tone?: string; height?: number; area?: boolean }) {
  const width = 120
  if (values.length < 2) return <div style={{ height }} />
  const max = Math.max(1, ...values)
  const step = width / (values.length - 1)
  const coordinates = values.map((value, index) => [index * step, height - (value / max) * (height - 4) - 2] as const)
  const path = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {area ? <path d={`${path} L${width} ${height} L0 ${height} Z`} fill={tone} opacity={0.1} /> : null}
      <path d={path} fill="none" stroke={tone} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coordinates.at(-1)![0]} cy={coordinates.at(-1)![1]} r={1.9} fill={tone} />
    </svg>
  )
}

export function Donut({ percent, label, sublabel, size = 92 }: { percent: number; label: string; sublabel?: string; size?: number }) {
  const radius = size / 2 - 7
  const circumference = 2 * Math.PI * radius
  const value = Math.min(100, Math.max(0, percent))
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${value}%`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={7} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
            className="transition-all duration-700"
          />
        </g>
        <text x="50%" y="47%" textAnchor="middle" fontSize={size / 5.4} fontWeight={600} fill="#0f172a">
          {value.toFixed(value < 10 ? 1 : 0)}%
        </text>
        <text x="50%" y="63%" textAnchor="middle" fontSize={size / 10} fill="#64748b">
          {sublabel ?? ''}
        </text>
      </svg>
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-slate-800">{label}</p>
      </div>
    </div>
  )
}

export function GrowthChart({ points, height = 90 }: { points: { day: string; added: number; unsubscribed: number }[]; height?: number }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.added, point.unsubscribed]))
  const width = Math.max(200, points.length * 22)
  const group = width / Math.max(1, points.length)
  return (
    <div className="overflow-x-auto no-scrollbar">
      <svg viewBox={`0 0 ${width} ${height + 16}`} width="100%" height={height + 16} preserveAspectRatio="none" role="img" aria-label="Subscriber growth">
        {points.map((point, index) => {
          const bar = (value: number, offset: number, color: string, name: string) => {
            const barHeight = (value / max) * (height - 14)
            return (
              <rect x={index * group + group / 2 - 4 + offset} y={height - barHeight} width={3.4} height={Math.max(value > 0 ? 1.5 : 0, barHeight)} rx={1.4} fill={color}>
                <title>{`${point.day} · ${name} ${value}`}</title>
              </rect>
            )
          }
          return (
            <g key={point.day}>
              {bar(point.added, -2, '#10b981', 'subscribed')}
              {bar(point.unsubscribed, 2, '#f43f5e', 'unsubscribed')}
              {index % Math.ceil(points.length / 7) === 0 ? (
                <text x={index * group + group / 2} y={height + 12} textAnchor="middle" fontSize={9} fill="#94a3b8">
                  {point.day.slice(5)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
