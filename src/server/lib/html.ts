/**
 * Email HTML helpers: sanitising stored templates, rewriting links for click
 * tracking, injecting the open pixel, and deriving a plain-text alternative.
 */

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'html', 'head', 'body', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small',
  'span', 'strong', 'style', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'u', 'ul',
])

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const unsafeUrl = (url: string) => /^\s*(javascript|vbscript|file):/i.test(url)

/**
 * Strip scripts, event handlers and `javascript:` URLs while keeping the email
 * markup intact. Applied when templates are saved, so the dashboard preview can
 * never execute arbitrary script.
 */
export function sanitizeEmailHtml(input: string): string {
  if (!input) return ''
  let out = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|iframe|object|embed|form|frame|frameset|applet|meta|link)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|frame|applet)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src|action)\s*=\s*"([^"]*)"/gi, (m, attr: string, url: string) => (unsafeUrl(url) ? `${attr}="#"` : m))
    .replace(/(href|src|action)\s*=\s*'([^']*)'/gi, (m, attr: string, url: string) => (unsafeUrl(url) ? `${attr}="#"` : m))

  // drop unknown tags but keep their inner text
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/g, (match, rawName: string) => {
    const name = rawName.toLowerCase()
    if (VOID_TAGS.has(name)) return match.startsWith('</') ? '' : match
    return ALLOWED_TAGS.has(name) ? match : ''
  })
  return out.trim()
}

/** Convert HTML to a readable plain-text alternative, keeping link targets. */
export function htmlToText(html: string): string {
  if (!html) return ''
  const text = html
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const clean = label.replace(/<[^>]+>/g, '').trim()
      if (!clean || clean === href) return clean || href
      return `${clean} (${href})`
    })
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|tr|h[1-6]|li|blockquote)\s*>/gi, '\n\n')
    .replace(/<\s*(td|th)\b[^>]*>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br />')
}

/* ── tracking rewrites ─────────────────────────────────────────────────────── */

const isExternalHttp = (url: string) => /^https?:\/\//i.test(url)

/**
 * Route every outbound link through `/t/c/<token>?u=…` so clicks are attributed
 * to a specific send. Links to our own tracking endpoints are left alone.
 */
export function rewriteLinks(html: string, clickUrl: string, baseUrl: string): string {
  if (!html || !clickUrl) return html
  const own = baseUrl.replace(/^https?:\/\//i, '')
  return html.replace(/(<a\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi, (match, prefix: string, _quoted: string, dq: string, sq: string) => {
    const url = (dq ?? sq ?? '').trim()
    if (!isExternalHttp(url)) return match
    if (url.replace(/^https?:\/\//i, '').startsWith(own)) return match
    const target = `${clickUrl}?u=${encodeURIComponent(url)}`
    return `${prefix}"${escapeHtml(target)}"`
  })
}

export function injectOpenPixel(html: string, pixelUrl: string): string {
  if (!html || !pixelUrl) return html
  const img = `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" border="0" style="display:block;height:1px;width:1px;border:0;margin:0;padding:0" />`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${img}</body>`)
  return `${html}\n${img}`
}

/** Small, well-tested fallback for contacts without an HTML client. */
export function buildUnsubscribeBlock(unsubscribeUrl: string, label = 'Unsubscribe'): string {
  return `<p style="margin:24px 0 0;font-size:12px;color:#64748b"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline">${escapeHtml(label)}</a></p>`
}

export function plainList(items: string[]): string {
  return items.map((i) => `  • ${i}`).join('\n')
}
