/**
 * Personalisation engine for subject / preheader / html / text.
 *
 *   {{ first_name }}              variable lookup
 *   {{ first_name | there }}      fallback when empty or unknown
 *   {{ fields.company }}          arbitrary custom field
 *   {{#if company }}…{{else}}…{{/if}}   conditional block (also {{#unless x}})
 */

export interface MergeContact {
  id?: number
  email: string
  name?: string
  fields?: Record<string, string>
}

export interface MergeContext {
  contact?: MergeContact | null
  campaign?: { name?: string } | null
  unsubscribeUrl?: string
  extra?: Record<string, string>
  now?: Date
}

const TOKEN_RE = /\{\{([^{}]+)\}\}/g
const BLOCK_RE = /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g
const UNLESS_RE = /\{\{#unless\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g

export function firstName(contact?: MergeContact | null): string {
  const explicit = contact?.fields?.first_name?.trim()
  if (explicit) return explicit
  const full = (contact?.name ?? '').trim()
  if (full) return full.split(/\s+/)[0]!
  return (contact?.email ?? '').split('@')[0]!.replace(/[._-]+/g, ' ').trim() || ''
}

export function lastName(contact?: MergeContact | null): string {
  const explicit = contact?.fields?.last_name?.trim()
  if (explicit) return explicit
  const parts = (contact?.name ?? '').trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : ''
}

export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** Every variable a context can resolve, for editor autocomplete + previews. */
export function buildScope(ctx: MergeContext): Record<string, string> {
  const contact = ctx.contact ?? null
  const now = ctx.now ?? new Date()
  const scope: Record<string, string> = {
    first_name: firstName(contact),
    last_name: lastName(contact),
    full_name: (contact?.name ?? '').trim() || titleCase(firstName(contact)),
    email: contact?.email ?? '',
    campaign: ctx.campaign?.name ?? '',
    unsubscribe_url: ctx.unsubscribeUrl ?? '',
    date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    year: String(now.getFullYear()),
    ...ctx.extra,
  }
  for (const [key, value] of Object.entries(contact?.fields ?? {})) {
    if (!(key in scope)) scope[key] = String(value ?? '')
    scope[`fields.${key}`] = String(value ?? '')
  }
  return scope
}

export function render(input: string, ctx: MergeContext): string {
  if (!input) return ''
  const scope = buildScope(ctx)

  const withBlocks = input
    .replace(UNLESS_RE, (_m, name: string, body: string) => (truthy(scope[name.trim()]) ? '' : body))
    .replace(BLOCK_RE, (_m, name: string, body: string) => {
      const elseAt = body.search(/\{\{\s*else\s*\}\}/)
      if (elseAt === -1) return truthy(scope[name.trim()]) ? body : ''
      return truthy(scope[name.trim()]) ? body.slice(0, elseAt) : body.slice(elseAt).replace(/^\s*\{\{\s*else\s*\}\}\s*/, '')
    })

  return withBlocks.replace(TOKEN_RE, (_m, raw: string) => {
    const [nameExpr, ...fallbackParts] = raw.split('|')
    const name = (nameExpr ?? '').trim()
    const fallback = fallbackParts.join('|').trim()
    const value = scope[name]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value)
    return fallback
  })
}

const truthy = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== ''

/** Unknown/typo'd variables are the #1 cause of broken emails — flag them. */
export function analyze(input: string, ctx: MergeContext): { used: string[]; unknown: string[] } {
  const scope = buildScope(ctx)
  const used = new Set<string>()
  const patterns = [/\{\{([^{}]+)\}\}/g, /\{\{#(?:if|unless)\s+([^}]+?)\s*\}\}/g]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(input || ''))) {
      const name = (m[1] ?? '').split('|')[0]!.trim()
      if (name && !name.startsWith('/')) used.add(name)
    }
  }
  const known = new Set([...Object.keys(scope), 'current_year', 'month_name', 'preheader'])
  const unknown = [...used].filter((u) => !known.has(u))
  return { used: [...used], unknown }
}

/** Render a preview using sample data (used by the template editor). */
export function sampleContact(overrides: Record<string, string> = {}): MergeContact {
  return {
    id: 0,
    email: overrides.email ?? 'ahsan@example.com',
    name: overrides.name ?? 'Ahsan Rahman',
    fields: { company: 'Northwind', plan: 'Pro', ...overrides },
  }
}
