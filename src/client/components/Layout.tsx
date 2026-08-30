import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useApp } from '../App'
import { api } from '../lib/api'
import { number, relative } from '../lib/format'
import { useInterval } from '../lib/hooks'
import { Badge, Button, IconButton } from './ui'
import { IconCheck, IconClose, IconGauge, IconInbox, IconMail, IconRefresh, IconSend, IconSettings, IconTag, IconTemplate, IconUsers, IconWarn } from './Icons'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  hint?: string
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <IconGauge size={17} /> },
  { to: '/campaigns', label: 'Campaigns', icon: <IconSend size={17} />, hint: 'broadcasts + drips' },
  { to: '/contacts', label: 'Contacts', icon: <IconUsers size={17} /> },
  { to: '/lists', label: 'Lists & tags', icon: <IconTag size={17} /> },
  { to: '/templates', label: 'Templates', icon: <IconTemplate size={17} /> },
  { to: '/inbox', label: 'Inbox', icon: <IconInbox size={17} />, hint: 'captured mail' },
  { to: '/settings', label: 'Settings', icon: <IconSettings size={17} /> },
]

interface EngineState {
  running: boolean
  queueDepth: number
  transport: string
  lastTickAt: string | null
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, workspaceName, demoMode, live, toast, refresh } = useApp()
  const [engine, setEngine] = useState<EngineState | null>(null)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  const poll = useCallback(async () => {
    try {
      setEngine(await api.engine.status())
    } catch {
      /* the strip is informational only */
    }
  }, [])

  useEffect(() => {
    void poll()
  }, [poll, live.revision])
  useInterval(() => void poll(), 6000)
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="flex h-full min-h-full bg-slate-100">
      {open ? <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" /> : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] transform flex-col bg-slate-950 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white shadow-lg shadow-brand-900/40">
            <IconMail size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] leading-tight font-semibold text-white">{workspaceName}</p>
            <p className="truncate text-[11px] text-slate-400">mail automation workspace</p>
          </div>
          <button type="button" className="text-slate-400 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <IconClose size={17} />
          </button>
        </div>

        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                  isActive ? 'bg-white/10 text-white shadow-inner' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`
              }
            >
              <span className="text-slate-400 group-hover:text-brand-200">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.to === '/inbox' && demoMode ? <span className="size-1.5 rounded-full bg-emerald-400" /> : null}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3.5 py-3 text-[11.5px] text-slate-400">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${live.connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {live.connected ? 'live' : 'reconnecting'}
            </span>
            <span className="tabular-nums">{engine ? `${number(engine.queueDepth)} queued` : '—'}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate">{engine?.transport === 'smtp' ? 'SMTP transport' : 'local mailbox'}</span>
            <span className="truncate">{engine?.lastTickAt ? relative(engine.lastTickAt) : 'idle'}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/85 px-3 py-2.5 backdrop-blur-md sm:px-5">
          <button type="button" className="btn btn-ghost btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {demoMode ? (
            <button
              type="button"
              onClick={() => {
                void refresh()
                toast('info', 'Demo mode', 'No SMTP host is configured, so every message is rendered and captured in the Inbox instead of being delivered.')
              }}
              className="hidden items-center gap-2 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 sm:inline-flex"
            >
              <IconWarn size={13} /> demo mode · messages captured locally
            </button>
          ) : (
            <Badge tone="emerald" dot className="hidden sm:inline-flex">
              SMTP live
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <IconButton label="Refresh data" onClick={() => void poll()}>
              <IconRefresh size={15} />
            </IconButton>
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1 sm:flex">
              <span className="grid size-6 place-items-center rounded-full bg-slate-900 text-[10px] font-semibold text-white uppercase">
                {(user?.email ?? '?').slice(0, 2)}
              </span>
              <span className="text-[12.5px] text-slate-600">{user?.name || user?.email}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void api.auth.logout().then(() => window.location.assign('/'))}>
              Sign out
            </Button>
          </div>
        </header>

        <main className="scroll-thin flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-7">{children}</main>
      </div>

      <Toasts />
    </div>
  )
}

function Toasts() {
  const { toasts, dismiss } = useApp()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] shadow-lg shadow-slate-900/5 ${
            toast.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : toast.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-800'
          }`}
        >
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${toast.kind === 'error' ? 'bg-rose-600' : toast.kind === 'success' ? 'bg-emerald-600' : 'bg-slate-800'} text-white`}>
            {toast.kind === 'error' ? <IconWarn size={12} /> : <IconCheck size={12} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{toast.title}</p>
            {toast.body ? <p className="mt-0.5 text-[12.5px] opacity-80">{toast.body}</p> : null}
          </div>
          <button type="button" onClick={() => dismiss(toast.id)} className="shrink-0 opacity-50 hover:opacity-100" aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
