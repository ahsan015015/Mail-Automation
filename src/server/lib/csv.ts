/** RFC-4180-ish CSV reader/writer — enough for contact import/export. */

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',') {
      record.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      continue
    }
    field += ch
  }
  if (field.length || record.length) {
    record.push(field)
    records.push(record)
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''))
  if (!nonEmpty.length) return { headers: [], rows: [] }

  const first = nonEmpty[0]!.map((h) => h.trim())
  const looksLikeHeader = first.some((h) => h.toLowerCase() === 'email') || !first.some((h) => h.includes('@'))
  if (looksLikeHeader) {
    return { headers: first.map((h) => h.toLowerCase().replace(/\s+/g, '_')), rows: nonEmpty.slice(1) }
  }
  return { headers: first.map((_, i) => (i === 0 ? 'email' : `column_${i + 1}`)), rows: nonEmpty }
}

/** Maps parsed CSV into contact-shaped objects, tolerating header aliases. */
export function csvToContacts(input: string): {
  contacts: { email: string; name: string; fields: Record<string, string> }[]
  skipped: { line: number; reason: string }[]
  columns: string[]
} {
  const { headers, rows } = parseCsv(input)
  const contacts: { email: string; name: string; fields: Record<string, string> }[] = []
  const skipped: { line: number; reason: string }[] = []
  if (!headers.length) return { contacts, skipped, columns: [] }

  const emailIdx = headers.findIndex((h) => ['email', 'e_mail', 'mail', 'email_address'].includes(h))
  if (emailIdx === -1) throw new Error(`No email column found. Headers seen: ${headers.join(', ') || '(none)'}`)
  const nameIdx = headers.findIndex((h) => ['name', 'full_name', 'fullname', 'contact_name'].includes(h))
  const firstIdx = headers.findIndex((h) => h === 'first_name' || h === 'firstname' || h === 'first')
  const lastIdx = headers.findIndex((h) => h === 'last_name' || h === 'lastname' || h === 'last')
  const statusIdx = headers.findIndex((h) => ['status', 'state'].includes(h))
  const tagsIdx = headers.findIndex((h) => ['tags', 'tag', 'labels'].includes(h))
  const reserved = new Set([emailIdx, nameIdx, firstIdx, lastIdx, statusIdx, tagsIdx].filter((i) => i > -1))
  const extraIdx = headers.map((h, i) => ({ h, i })).filter(({ i }) => !reserved.has(i))

  rows.forEach((row, i) => {
    const email = (row[emailIdx] ?? '').trim()
    if (!email) {
      skipped.push({ line: i + 1, reason: 'missing email' })
      return
    }
    const fromName = (row[nameIdx] ?? '').trim()
    const composed = [row[firstIdx] ?? '', row[lastIdx] ?? ''].join(' ').trim()
    const fields: Record<string, string> = {}
    for (const { h, i: idx } of extraIdx) {
      const value = (row[idx] ?? '').trim()
      if (value && h) fields[h] = value
    }
    const rawTags = (tagsIdx > -1 ? row[tagsIdx] : '') ?? ''
    const tags = rawTags
      .split(/[;,|]/)
      .map((t) => t.trim())
      .filter(Boolean)

    contacts.push({
      email,
      name: fromName || composed,
      fields: tags.length ? { ...fields, tags: tags.join(',') } : fields,
    })
  })

  const columns = extraIdx.map(({ h }) => h).filter(Boolean)
  return { contacts, skipped, columns }
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  if (!rows.length) return ''
  const cols = headers ?? Object.keys(rows[0]!)
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [cols.map(escape).join(',')]
  for (const row of rows) lines.push(cols.map((c) => escape(row[c])).join(','))
  return lines.join('\r\n')
}
