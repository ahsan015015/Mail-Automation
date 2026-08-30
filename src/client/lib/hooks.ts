import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiError, type ApiError } from './api'

export interface AsyncState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
  setData: (value: T) => void
}

/** Tiny data-fetching hook: keeps the last data visible while refetching. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useRef(loader)
  load.current = loader
  const alive = useRef(true)

  const run = useCallback(async () => {
    try {
      const value = await load.current()
      if (!alive.current) return
      setData(value)
      setError(null)
    } catch (cause) {
      if (!alive.current) return
      setError(cause instanceof Error ? (cause as ApiError) : apiError(String(cause), 0))
    } finally {
      if (alive.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    alive.current = true
    void run()
    return () => {
      alive.current = false
    }
  }, [run])

  return useMemo(() => ({ data, error, loading, reload: () => void run(), setData: (value: T) => setData(value) }), [data, error, loading, run])
}

export type LiveEvent = { type: string; payload: unknown }

/**
 * Server-sent events, with a reconnect that backs off. `revision` bumps on every
 * message so queries can list it as a dependency and refetch automatically.
 */
export function useLiveStream(enabled = true): { revision: number; connected: boolean; last: LiveEvent | null } {
  const supported = typeof EventSource !== 'undefined'
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(false)
  const [last, setLast] = useState<LiveEvent | null>(null)
  const source = useRef<EventSource | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const throttle = useRef(0)

  useEffect(() => {
    if (!enabled || !supported) return
    let closed = false

    const connect = () => {
      if (closed) return
      const stream = new EventSource('/api/stream')
      source.current = stream
      const bump = (type: string) => (event: MessageEvent) => {
        setConnected(true)
        let payload: unknown = null
        try {
          payload = JSON.parse(event.data)
        } catch {
          payload = event.data
        }
        setLast({ type, payload })
        const now = Date.now()
        if (type === 'ready' || now - throttle.current > 900) {
          throttle.current = now
          setRevision((value) => value + 1)
        }
      }
      for (const type of ['ready', 'event', 'engine', 'tracking', 'contact', 'campaign']) stream.addEventListener(type, bump(type) as EventListener)
      stream.onerror = () => {
        setConnected(false)
        stream.close()
        if (closed) return
        if (retry.current) clearTimeout(retry.current)
        retry.current = setTimeout(connect, 3000)
      }
      stream.onopen = () => setConnected(true)
    }

    connect()
    return () => {
      closed = true
      if (retry.current) clearTimeout(retry.current)
      source.current?.close()
      source.current = null
    }
  }, [enabled, supported])

  return { revision, connected, last }
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  body?: string
}

export function useToasts(): {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
} {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-3), { ...toast, id }])
      setTimeout(() => dismiss(id), toast.kind === 'error' ? 8000 : 4200)
    },
    [dismiss],
  )

  return { toasts, push, dismiss }
}

/** Persist small UI preferences (page size, tab, filters). */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* private mode */
      }
    },
    [key],
  )
  return [value, update]
}

export function useInterval(callback: () => void, ms: number | null): void {
  const ref = useRef(callback)
  ref.current = callback
  useEffect(() => {
    if (ms === null) return
    const timer = setInterval(() => ref.current(), ms)
    return () => clearInterval(timer)
  }, [ms])
}

/** Escape closes overlays, without stealing focus from inputs. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onEscape])
}
