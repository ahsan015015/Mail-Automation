import fs from 'node:fs'
import path from 'node:path'

/**
 * Minimal `.env` loader (no dependency needed).
 * - ignores comments and blank lines
 * - supports `export KEY=value`, single/double quotes and inline `\#` comments
 * - never overwrites a variable that already exists in the environment
 */
export function loadEnvFile(cwd = process.cwd()): void {
  const file = path.join(cwd, '.env')
  if (!fs.existsSync(file)) return

  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) continue

    const key = match[1]
    let value = (match[2] ?? '').trim()

    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1).replace(/\\n/g, '\n')
    } else {
      const hash = value.indexOf(' #')
      if (hash > -1) value = value.slice(0, hash).trim()
    }

    if (process.env[key] === undefined) process.env[key] = value
  }
}
