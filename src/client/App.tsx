import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, isDemoBuild, type ApiError, type Bootstrap } from './lib/api'
import { useLiveStream, useToasts, type Toast } from './lib/hooks'
import { Shell } from './components/Layout'
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { CampaignsPage } from './pages/Campaigns'
import { NewCampaignPage } from './pages/NewCampaign'
import { CampaignDetailPage } from './pages/CampaignDetail'
import { ContactsPage } from './pages/Contacts'
import { ListsPage } from './pages/Lists'
import { TemplatesPage } from './pages/Templates'
import { InboxPage } from './pages/Inbox'
import { SettingsPage } from './pages/Settings'

export interface AppValue {
  user: Bootstrap['user']
  needsSetup: boolean
  workspaceName: string
  demoMode: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  toasts: Toast[]
  toast: (kind: Toast['kind'], title: string, body?: string) => void
  dismiss: (id: number) => void
  live: { revision: number; connected: boolean }
}

const AppContext = createContext<AppValue | null>(null)
export const useApp = (): AppValue => {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside <App>')
  return value
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const { toasts, push, dismiss } = useToasts()
  const live = useLiveStream(!isDemoBuild && Boolean(boot?.user))

  const load = useCallback(async () => {
    try {
      const next = await api.bootstrap()
      setBoot(next)
      setFatal(null)
    } catch (error) {
      const message = (error as ApiError).message ?? 'Could not reach the Mail Automation server'
      setFatal(message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined)
    setBoot((current) => (current ? { ...current, user: null } : current))
    push({ kind: 'info', title: 'Signed out' })
  }, [push])

  const value = useMemo<AppValue>(
    () => ({
      user: boot?.user ?? null,
      needsSetup: Boolean(boot?.needsSetup),
      workspaceName: boot?.settings?.workspaceName ?? 'Mail Automation',
      demoMode: boot?.settings ? !boot.settings.smtp.host || boot.settings.transport === 'memory' : false,
      refresh: load,
      signOut,
      toasts,
      toast: (kind, title, body) => push({ kind, title, body }),
      dismiss,
      live: { revision: live.revision, connected: live.connected },
    }),
    [boot, load, signOut, toasts, push, dismiss, live.revision, live.connected],
  )

  if (!boot) {
    return (
      <div className="grid h-full place-items-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
              <path d="m3.5 7 8.5 6 8.5-6" />
            </svg>
          </div>
          <p className="text-[13px] text-slate-500">{fatal ?? 'Starting workspace…'}</p>
          {fatal ? (
            <button type="button" className="btn-secondary btn btn-sm" onClick={() => void load()}>
              Try again
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (!boot.user) {
    return (
      <AppContext.Provider value={value}>
        <LoginPage needsSetup={boot.needsSetup} onDone={() => void load()} />
      </AppContext.Provider>
    )
  }

  return (
    <AppContext.Provider value={value}>
      <Shell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/new" element={<NewCampaignPage />} />
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AppContext.Provider>
  )
}

export const usePageTitle = (title: string): void => {
  const { workspaceName } = useApp()
  const location = useLocation()
  useEffect(() => {
    document.title = `${title} · ${workspaceName}`
    return () => {
      document.title = workspaceName
    }
  }, [title, workspaceName, location.pathname])
}
