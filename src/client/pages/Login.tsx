import { useState } from 'react'
import { api } from '../lib/api'
import { Button, Field, Input } from '../components/ui'
import { IconCheck, IconGauge, IconInbox } from '../components/Icons'

interface Props {
  needsSetup: boolean
  onDone: () => Promise<void> | void
}

export function LoginPage({ needsSetup, onDone }: Props) {
  const [mode, setMode] = useState<'signin' | 'setup'>(needsSetup ? 'setup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'setup') {
        await api.auth.setup({ name: name.trim() || undefined, email: email.trim(), password })
      }
      await api.auth.login(email.trim(), password)
      await onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, rgba(79,70,229,0.5), transparent), radial-gradient(50% 50% at 90% 80%, rgba(16,185,129,0.28), transparent)',
          }}
        />
        <div className="relative">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <IconInbox size={20} />
          </span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">Email automation you can run on your own server.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Build lists and segments, write drip campaigns with merge tags, send through your own SMTP relay — and watch opens, clicks and bounces arrive live.
          </p>
          <ul className="mt-8 space-y-3 text-[14px] text-slate-300">
            {[
              { icon: <IconGauge size={15} />, text: 'Multi-step drips with delays, scheduling, rate caps and retries' },
              { icon: <IconCheck size={15} />, text: 'One-click unsubscribe (RFC 8058), open tracking, click redirects' },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-white/10 text-brand-200">{item.icon}</span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-slate-500">No third-party trackers — everything stays in one SQLite file.</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <span className="mb-6 grid size-10 place-items-center rounded-xl bg-brand-600 text-white shadow-sm lg:hidden">
            <IconInbox size={20} />
          </span>
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">{mode === 'setup' ? 'Create your workspace' : 'Sign in'}</h2>
          <p className="mt-1.5 text-[13.5px] text-slate-500">
            {mode === 'setup' ? 'Pick an email and password — this account becomes the workspace owner.' : 'Enter the credentials for your workspace.'}
          </p>

          <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
            {mode === 'setup' ? (
              <>
                <Field label="Your name" hint="The workspace is named after you until you change it in Settings.">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ada Quill" autoFocus />
                </Field>
              </>
            ) : null}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
                autoFocus={mode !== 'setup'}
              />
            </Field>
            <Field label="Password" hint={mode === 'setup' ? 'At least 10 characters.' : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                required
              />
            </Field>
            {error ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy} className="w-full justify-center">
              {mode === 'setup' ? 'Create workspace' : 'Sign in'}
            </Button>
          </form>

          {needsSetup ? (
            <button
              type="button"
              className="mt-5 text-[13px] text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline"
              onClick={() => {
                setMode(mode === 'setup' ? 'signin' : 'setup')
                setError(null)
              }}
            >
              {mode === 'setup' ? 'Already set up? Sign in' : 'I already have an account'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
