import { escapeHtml } from './html.js'

/**
 * Tiny server-rendered pages for the endpoints a recipient may open directly
 * (unsubscribe, preferences, subscribe confirmation). Deliberately dependency
 * free and self-contained so they work even if the SPA bundle is missing.
 */
export function page(options: {
  title: string
  heading: string
  body: string
  tone?: 'ok' | 'warn' | 'neutral'
  brand?: string
  actions?: { label: string; href?: string; method?: 'get' | 'post'; primary?: boolean }[]
}): string {
  const tone = options.tone ?? 'neutral'
  const badge =
    tone === 'ok'
      ? '<div class="badge ok">✓ Done</div>'
      : tone === 'warn'
        ? '<div class="badge warn">!</div>'
        : '<div class="badge">i</div>'
  const actions = (options.actions ?? [])
    .map((action) => {
      if (action.method === 'post') {
        return `<form method="post" action="${escapeHtml(action.href ?? '')}" style="display:inline">${`<button class="${action.primary ? 'primary' : ''}" type="submit">${escapeHtml(action.label)}</button>`}</form>`
      }
      return `<a class="${action.primary ? 'primary' : ''}" href="${escapeHtml(action.href ?? '#')}">${escapeHtml(action.label)}</a>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f1f5f9;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#0f172a; padding:24px; }
      .card { width:100%; max-width:460px; background:#fff; border:1px solid #e2e8f0; border-radius:16px;
              padding:32px; box-shadow:0 12px 32px -18px rgba(15,23,42,.35); }
      .brand { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#64748b; font-weight:600; }
      .badge { width:44px; height:44px; border-radius:999px; display:grid; place-items:center; margin:18px 0 14px;
               background:#eef2ff; color:#4f46e5; font-size:20px; font-weight:700; }
      .badge.ok { background:#ecfdf5; color:#047857; }
      .badge.warn { background:#fffbeb; color:#b45309; }
      h1 { margin:0 0 8px; font-size:21px; line-height:1.3; }
      p { margin:0 0 14px; color:#475569; font-size:14.5px; line-height:1.6; }
      .row { display:flex; gap:10px; flex-wrap:wrap; margin-top:20px; }
      a, button { display:inline-block; padding:10px 16px; border-radius:10px; text-decoration:none; font-size:14px;
                  border:1px solid #cbd5e1; color:#0f172a; background:#fff; cursor:pointer; font-family:inherit; }
      a:hover, button:hover { border-color:#94a3b8; }
      .primary { background:#4f46e5; border-color:#4f46e5; color:#fff; font-weight:600; }
      .primary:hover { background:#4338ca; }
      .meta { margin-top:22px; padding-top:16px; border-top:1px solid #f1f5f9; font-size:12.5px; color:#94a3b8; }
      table { width:100%; border-collapse:collapse; font-size:14px; margin-top:6px; }
      td { padding:8px 0; border-bottom:1px solid #f1f5f9; }
      td:last-child { text-align:right; color:#475569; }
      input { width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:14px; margin-bottom:10px; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand">${escapeHtml(options.brand ?? 'Mail Automation')}</div>
      ${badge}
      <h1>${escapeHtml(options.heading)}</h1>
      ${options.body}
      ${actions ? `<div class="row">${actions}</div>` : ''}
      <div class="meta">Handled by Mail Automation</div>
    </main>
  </body>
</html>`
}
