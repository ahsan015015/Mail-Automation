import { describe, expect, it } from 'vitest'
import { csvToContacts, parseCsv, toCsv } from '../src/server/lib/csv.js'
import { escapeHtml, htmlToText, injectOpenPixel, rewriteLinks, sanitizeEmailHtml } from '../src/server/lib/html.js'

describe('csv', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    const parsed = parseCsv('email,name,note\na@x.test,"Doe, Jane","said ""hi"""\nb@x.test,Bob,')
    expect(parsed.headers).toEqual(['email', 'name', 'note'])
    expect(parsed.rows).toEqual([
      ['a@x.test', 'Doe, Jane', 'said "hi"'],
      ['b@x.test', 'Bob', ''],
    ])
  })

  it('maps header aliases and collects extra columns as fields', () => {
    const { contacts, columns } = csvToContacts('Email,First Name,Last Name,Plan,Tags\nJOE@X.TEST,Joe,Bloggs,Pro,vip;trial')
    expect(contacts[0]).toMatchObject({ email: 'JOE@X.TEST', name: 'Joe Bloggs' })
    expect(contacts[0]!.fields).toEqual({ plan: 'Pro', tags: 'vip,trial' })
    expect(columns).toEqual(['plan'])
  })

  it('accepts a headerless first column as email', () => {
    const parsed = parseCsv('solo@x.test,Solo')
    expect(parsed.headers[0]).toBe('email')
  })

  it('throws a helpful error when no email column exists', () => {
    expect(() => csvToContacts('name,age\nBob,4')).toThrow(/No email column/)
  })

  it('round-trips through toCsv with escaping', () => {
    const csv = toCsv([{ email: 'a@x.test', name: 'Comma, "quoted"' }], ['email', 'name'])
    expect(csv).toContain('"Comma, ""quoted"""')
    expect(parseCsv(csv).rows[0]![1]).toBe('Comma, "quoted"')
  })
})

describe('email html', () => {
  it('escapes markup for text contexts', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('removes scripts, handlers and javascript: urls', () => {
    const dirty = `<p onclick="steal()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="x" onerror="alert(2)">`
    const clean = sanitizeEmailHtml(dirty)
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('steal()')
    expect(clean).not.toContain('alert(2)')
    expect(clean).toContain('href="#"')
    expect(clean).toContain('<p>hi</p>')
  })

  it('derives plain text that keeps link targets', () => {
    const text = htmlToText('<h2>Title</h2><p>Read <a href="https://x.test/a">the guide</a></p>')
    expect(text).toContain('Title')
    expect(text).toContain('the guide (https://x.test/a)')
    expect(text).not.toContain('<')
  })

  it('routes external links through the click endpoint only', () => {
    const html = `<a href="https://track.example.com/x">own</a><a href="https://evil.test/p">ext</a><a href="mailto:a@b.c">mail</a>`
    const rewritten = rewriteLinks(html, 'http://app.test/t/c/TOKEN', 'http://app.test')
    expect(rewritten).toContain('href="http://app.test/t/c/TOKEN?u=https%3A%2F%2Fevil.test%2Fp"')
    expect(rewritten).toContain('>own</a>')
    expect(rewritten).toContain('mailto:a@b.c')
  })

  it('injects the open pixel before </body>', () => {
    const html = injectOpenPixel('<html><body><p>hi</p></body></html>', 'http://app.test/t/o/T')
    expect(html.indexOf('t/o/T')).toBeLessThan(html.indexOf('</body>'))
    expect(injectOpenPixel('<p>no body tag</p>', 'http://app.test/t/o/T')).toMatch(/<\/body>$|^<p>no body tag<\/p>\n<img/)
  })

  it('is a no-op without a pixel url', () => {
    expect(injectOpenPixel('<p>x</p>', '')).toBe('<p>x</p>')
    expect(rewriteLinks('<p>x</p>', '', 'http://app.test')).toBe('<p>x</p>')
  })
})
