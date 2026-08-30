import { describe, expect, it } from 'vitest'
import { readToken, signToken, randomToken } from '../src/server/lib/tokens.js'
import { hashPassword, passwordIssues, verifyPassword } from '../src/server/lib/password.js'
import { signSession, verifySession } from '../src/server/lib/jwt.js'
import { isPermanentFailure } from '../src/server/services/mailer.js'
import { isValidEmail, normalizeEmail, serializeCookie, parseCookies } from '../src/server/lib/http.js'
import { page } from '../src/server/lib/page.js'
import { clampInt, localHour, localWeekend, rate, round, truncate } from '../src/server/lib/util.js'

describe('signed tracking tokens', () => {
  it('round-trips a payload', () => {
    const token = signToken({ k: 'o', i: 42, cid: 7 })
    expect(readToken(token)).toEqual({ k: 'o', i: 42, cid: 7 })
  })

  it('rejects tampered payloads', () => {
    const token = signToken({ k: 'u', i: 1 })
    const [body, sig] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ k: 'u', i: 999 })).toString('base64url')}.${sig}`
    expect(readToken(forged)).toBeNull()
    expect(readToken(body!)).toBeNull()
    expect(readToken('')).toBeNull()
    expect(readToken(null)).toBeNull()
  })

  it('produces unguessable list tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()))
    expect(tokens.size).toBe(200)
  })
})

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const hash = hashPassword('correct horse battery')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery', hash)).toBe(true)
    expect(verifyPassword('Correct horse battery', hash)).toBe(false)
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false)
  })

  it('salts so identical passwords hash differently', () => {
    expect(hashPassword('same-passphrase')).not.toBe(hashPassword('same-passphrase'))
  })

  it('has a minimum strength policy', () => {
    expect(passwordIssues('short')).toContain('must be at least 10 characters')
    expect(passwordIssues('alllowercase')).toHaveLength(1)
    expect(passwordIssues('alllowercase123')).toHaveLength(0)
    expect(passwordIssues('GoodEnough1234')).toHaveLength(0)
  })
})

describe('sessions', () => {
  it('verifies a freshly signed token', () => {
    const claims = verifySession(signSession({ uid: 3, email: 'a@b.cc' }))
    expect(claims).toMatchObject({ uid: 3, email: 'a@b.cc' })
  })

  it('refuses an expired or forged token', () => {
    expect(verifySession(signSession({ uid: 1, email: 'a@b.cc' }, -10))).toBeNull()
    expect(verifySession('garbage')).toBeNull()
    const [head, payload] = signSession({ uid: 1, email: 'a@b.cc' }).split('.')
    expect(verifySession(`${head}.${payload}.AAAA`)).toBeNull()
  })
})

describe('delivery failure classification', () => {
  it('treats 5x replies as permanent and 4x as retryable', () => {
    expect(isPermanentFailure(Object.assign(new Error('550 user unknown'), { responseCode: 550 }))).toBe(true)
    expect(isPermanentFailure(Object.assign(new Error('421 busy'), { responseCode: 421 }))).toBe(false)
    expect(isPermanentFailure(Object.assign(new Error('nope'), { code: 'EENVELOPE' }))).toBe(true)
    expect(isPermanentFailure(new Error('socket hang up'))).toBe(false)
    expect(isPermanentFailure(undefined)).toBe(false)
  })
})

describe('http + util helpers', () => {
  it('validates and normalises addresses', () => {
    expect(isValidEmail(' A@B.Co ')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(normalizeEmail('Mixed@Case.COM')).toBe('mixed@case.com')
    expect(isValidEmail('a@b,c@d.com')).toBe(false)
  })

  it('round-trips cookies', () => {
    const header = serializeCookie('ma_session', 'a b', { maxAgeSeconds: 60 })
    expect(header).toContain('HttpOnly')
    expect(parseCookies(`${header}; other=1`).ma_session).toBe('a b')
    expect(parseCookies(undefined)).toEqual({})
  })

  it('clamps, rounds and rates', () => {
    expect(clampInt('500', 1, 60)).toBe(60)
    expect(clampInt('nope', 1, 60, 7)).toBe(7)
    expect(rate(1, 3)).toBe(33.3)
    expect(rate(1, 0)).toBe(0)
    expect(round(1.23456, 2)).toBe(1.23)
    expect(truncate('a'.repeat(200), 10)).toHaveLength(10)
  })

  it('honours timezones for windows and weekends', () => {
    const atUTC1 = new Date('2026-03-05T01:00:00.000Z')
    expect(localHour(atUTC1, 'UTC')).toBe(1)
    expect(localHour(atUTC1, 'Asia/Dhaka')).toBe(7)
    expect(localWeekend(atUTC1, 'UTC')).toBe(false)
    expect(localWeekend(new Date('2026-03-07T01:00:00.000Z'), 'UTC')).toBe(true)
  })

  it('renders recipient-facing pages with escaped content', () => {
    const html = page({ title: 'T', heading: 'Unsubscribe <b>me</b>', body: '<p>ok</p>', tone: 'ok' })
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('heading: <b>')
    expect(html).toContain('✓ Done')
  })
})
