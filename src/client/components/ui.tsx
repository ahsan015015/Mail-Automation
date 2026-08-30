import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEscape } from '../lib/hooks'
import { IconCheck, IconClose, IconCopy, IconSpinner, IconWarn } from './Icons'

/* ── surfaces ──────────────────────────────────────────────────────────────── */

export function Card({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={`card ${className}`}>{children}</Tag>
}

export function CardHead({
  title,
  subtitle,
  actions,
  icon,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <header className={`flex flex-wrap items-start gap-3 border-b border-slate-200/70 px-4 py-3 sm:px-5 ${className}`}>
      {icon ? <span className="mt-0.5 text-brand-600">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14.5px] font-semibold tracking-tight text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[20px] leading-tight font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-[13px] text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/* ── buttons ───────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'md' | 'sm'; loading?: boolean; icon?: ReactNode }) {
  const styles = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' }[variant]
  return (
    <button type="button" className={`${styles} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={rest.disabled || loading} {...rest}>
      {loading ? <IconSpinner size={14} /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`btn btn-ghost btn-sm !px-1.5 text-slate-500 hover:text-slate-900 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={done ? <IconCheck size={14} className="text-emerald-600" /> : <IconCopy size={14} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          const area = document.createElement('textarea')
          area.value = value
          document.body.append(area)
          area.select()
          document.execCommand('copy')
          area.remove()
        }
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  )
}

/* ── form controls ─────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
  htmlFor,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-[12px] font-medium text-rose-600">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

export const Input = ({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) => <input className={`field ${className}`} {...rest} />

export const Textarea = ({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) => (
  <textarea className={`field ${className}`} rows={rest.rows ?? 6} {...rest} />
)

export const Select = ({ className = '', children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`field appearance-none bg-[length:14px] pr-8 ${className}`} {...rest}>
    {children}
  </select>
)

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (next: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded border border-slate-300 bg-white checked:border-brand-600 checked:bg-brand-600 focus:ring-2 focus:ring-brand-500/30"
        style={checked ? { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5 6.5 11.5 12.5 5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundSize: '12px' } : undefined}
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-slate-700">{label}</span>
        {hint ? <span className="block text-[12px] text-slate-500">{hint}</span> : null}
      </span>
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (next: boolean) => void; label?: ReactNode; hint?: string; disabled?: boolean }) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === 'string' ? label : 'toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'} disabled:opacity-50`}
    >
      <span className={`inline-block size-[18px] transform rounded-full bg-white shadow transition ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  )
  if (!label) return control
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-[13px] text-slate-700">{label}</span>
        {hint ? <span className="block text-[12px] text-slate-500">{hint}</span> : null}
      </span>
      {control}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode; count?: number }[]; onChange: (next: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-0.5 no-scrollbar">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`${size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-1.5 text-[12.5px]'} whitespace-nowrap rounded-md font-medium transition ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {option.label}
            {option.count !== undefined ? <span className={`ml-1.5 tabular-nums ${active ? 'text-slate-400' : 'text-slate-400'}`}>{option.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/* ── indicators ────────────────────────────────────────────────────────────── */

type Tone = 'slate' | 'brand' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'

const TONES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
}

export function Badge({ children, tone = 'slate', dot = false, className = '' }: { children: ReactNode; tone?: Tone; dot?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  )
}

const CAMPAIGN_TONE: Record<string, Tone> = { draft: 'slate', scheduled: 'sky', running: 'emerald', paused: 'amber', completed: 'brand', canceled: 'rose' }
export const CampaignBadge = ({ status }: { status: string }) => (
  <Badge tone={CAMPAIGN_TONE[status] ?? 'slate'} dot={status === 'running'} className={status === 'running' ? 'live-dot' : ''}>
    {status[0]!.toUpperCase() + status.slice(1)}
  </Badge>
)

const SEND_TONE: Record<string, Tone> = { queued: 'slate', sending: 'sky', sent: 'emerald', failed: 'rose', bounced: 'rose', skipped: 'amber' }
export const SendBadge = ({ status }: { status: string }) => (
  <Badge tone={SEND_TONE[status] ?? 'slate'} dot={status === 'sending'}>
    {status[0]!.toUpperCase() + status.slice(1)}
  </Badge>
)

const CONTACT_TONE: Record<string, Tone> = { subscribed: 'emerald', unsubscribed: 'slate', bounced: 'rose', complained: 'rose', pending: 'amber' }
export const ContactBadge = ({ status }: { status: string }) => (
  <Badge tone={CONTACT_TONE[status] ?? 'slate'}>{status[0]!.toUpperCase() + status.slice(1)}</Badge>
)

export function Progress({ value, tone = 'brand', className = '' }: { value: number; tone?: Tone; className?: string }) {
  const colors: Record<Tone, string> = {
    brand: 'bg-brand-600',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-400',
    sky: 'bg-sky-500',
    violet: 'bg-violet-500',
  }
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${colors[tone]}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function Kpi({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
  children,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="card card-pad flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon ? <span className={`grid size-6 place-items-center rounded-md ${TONES[tone]}`}>{icon}</span> : null}
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
        {children ? <span className="ml-auto">{children}</span> : null}
      </div>
      <div className="text-[24px] leading-none font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {sub ? <div className="text-[12px] text-slate-500">{sub}</div> : null}
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <span className="grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-400">{icon}</span> : null}
      <div>
        <p className="text-[14.5px] font-semibold text-slate-800">{title}</p>
        {body ? <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">{body}</p> : null}
      </div>
      {action}
    </div>
  )
}

export const Skeleton = ({ className = 'h-4 w-full' }: { className?: string }) => <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-500">
      <IconSpinner size={15} /> {label}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: { message: string; issues?: { path: string; message: string }[] } | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[12.5px] text-rose-800">
      <IconWarn size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{error.message}</p>
        {error.issues?.length ? (
          <ul className="mt-1 space-y-0.5 text-rose-700/90">
            {error.issues.slice(0, 6).map((issue, index) => (
              <li key={index}>
                <span className="font-mono text-[11.5px]">{issue.path}</span> — {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium text-rose-700 underline decoration-rose-300 hover:text-rose-900">
          retry
        </button>
      ) : null}
    </div>
  )
}

/* ── overlays ──────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEscape(open, onClose)
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/35 p-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className={`card w-full ${width} animate-rise overflow-hidden`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-slate-200/70 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <IconClose size={15} />
          </IconButton>
        </div>
        <div className="scroll-thin max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 bg-slate-50/60 px-4 py-3 sm:px-5">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body?: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-slate-600">{body}</div>
    </Modal>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside className={`flex h-full w-full ${width} animate-rise flex-col bg-white shadow-2xl`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>
  )
}

/* ── misc ──────────────────────────────────────────────────────────────────── */

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (next: T) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 no-scrollbar">
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {tab.label}
            {tab.badge}
          </button>
        )
      })}
    </nav>
  )
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (next: number) => void }) {
  if (totalPages <= 1) return <div className="px-4 py-2.5 text-[12px] text-slate-500">{total === 0 ? 'No rows' : `${total} row${total === 1 ? '' : 's'}`}</div>
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px] text-slate-500">
      <span>
        page {page} of {totalPages} · {total} rows
      </span>
      <span className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </div>
  )
}

export function Avatar({ name, email, tone = 'brand', size = 32 }: { name?: string; email: string; tone?: Tone; size?: number }) {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const label = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
  return (
    <span className={`grid shrink-0 place-items-center rounded-full text-[11px] font-semibold ${TONES[tone]}`} style={{ width: size, height: size }}>
      {label}
    </span>
  )
}

export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-100 pb-1.5 sm:block sm:border-0 sm:pb-0">
          <dt className="text-[12px] text-slate-500">{item.label}</dt>
          <dd className="text-right text-[13px] font-medium text-slate-800 sm:mt-0.5 sm:text-left">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Auto-growing textarea for HTML/markup editing. */
export function AutoTextarea({ value, minRows = 6, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minRows * 20, el.scrollHeight + 2)}px`
  }, [value, minRows])
  return <textarea ref={ref} rows={minRows} {...rest} className={`field resize-y ${rest.className ?? ''}`} value={value} />
}
