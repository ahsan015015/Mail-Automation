/* eslint-disable no-console */
import { config } from './config.js'

const level = (process.env.LOG_LEVEL || (config.isTest ? 'error' : 'info')) as 'debug' | 'info' | 'warn' | 'error'
const order = { debug: 10, info: 20, warn: 30, error: 40 } as const
const useColor = !config.isProd && process.stdout.isTTY !== false
const paint = (c: string, s: string) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s)

const stamp = () => new Date().toISOString().slice(11, 19)

function emit(kind: keyof typeof order, tag: string, args: unknown[]) {
  if (order[kind] < order[level]) return
  const color = kind === 'error' ? '31' : kind === 'warn' ? '33' : kind === 'debug' ? '90' : '36'
  const head = `${paint('90', stamp())} ${paint(color, tag.padEnd(9, ' '))}`
  const line = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : safeJson(a)))
    .join(' ')
  const out = kind === 'error' || kind === 'warn' ? console.error : console.log
  out(`${head} ${line}`)
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = {
  info: (...a: unknown[]) => emit('info', 'info', a),
  warn: (...a: unknown[]) => emit('warn', 'warn', a),
  error: (...a: unknown[]) => emit('error', 'error', a),
  debug: (...a: unknown[]) => emit('debug', 'debug', a),
  scope: (name: string) => ({
    info: (...a: unknown[]) => emit('info', name, a),
    warn: (...a: unknown[]) => emit('warn', name, a),
    error: (...a: unknown[]) => emit('error', name, a),
    debug: (...a: unknown[]) => emit('debug', name, a),
  }),
}

export const log = logger.scope('app')
