/**
 * Builds the standalone document that the template preview iframe renders.
 *
 * The preview is handed to the frame declaratively as `srcdoc` instead of being
 * written into it with `document.open()/write()/close()`. The imperative write
 * races the frame's own boot: by the time the effect runs, the iframe's initial
 * `about:blank` document may still be loading, and whatever was written is
 * discarded once that load completes and swaps the document in — leaving a
 * blank preview with nothing logged. `srcdoc` cannot race, because the browser
 * parses it as the frame's document when the frame boots, and re-parses it
 * whenever the value changes.
 *
 * The shell also adds the two things a bare `document.write` silently lacks:
 *
 *  - `<meta charset="utf-8">`, so non-ASCII copy (extremely common in email)
 *    is not rendered as mojibake.
 *  - `<base target="_blank">`, so clicking a tracked link in the preview opens
 *    a new tab rather than navigating the sandboxed frame away from the
 *    preview — a navigation the frame cannot perform, which blanks it.
 */

/** Injected into the head of every preview document. */
const PREVIEW_HEAD = '<meta charset="utf-8"><base target="_blank">'

const EMPTY_BODY =
  '<p style="margin:16px;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:#64748b">Nothing to preview yet — add some HTML and render it.</p>'

const shell = (body: string): string =>
  `<!doctype html><html><head>${PREVIEW_HEAD}</head><body style="margin:0">${body}</body></html>`

/**
 * Replaces the first literal occurrence of `needle`. A function replacer is
 * used so `$` sequences in the matched markup are never interpreted.
 */
const injectAfter = (source: string, needle: string, extra: string): string =>
  source.replace(needle, () => `${needle}${extra}`)

/**
 * Full email documents keep their own `<head>` so their `<style>` blocks stay
 * where the author put them; fragments get wrapped in a minimal shell.
 */
export const buildPreviewDocument = (html: string): string => {
  const source = (html ?? '').trim()
  if (!source) return shell(EMPTY_BODY)

  if (!/<html[\s>]/i.test(source)) return shell(source)

  const head = source.match(/<head[^>]*>/i)
  if (head) return injectAfter(source, head[0], PREVIEW_HEAD)

  const open = source.match(/<html[^>]*>/i)
  if (open) return injectAfter(source, open[0], `<head>${PREVIEW_HEAD}</head>`)

  return shell(source)
}
