import crypto from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const

/** `scrypt$N$r$p$salt$hash` — no native dependency, safe for a self-hosted app. */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(plain.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(hashB64!, 'base64')
    const actual = crypto.scryptSync(plain.normalize('NFKC'), Buffer.from(saltB64!, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function passwordIssues(pw: string): string[] {
  const issues: string[] = []
  if (pw.length < 10) issues.push('must be at least 10 characters')
  if (!/[a-z]/.test(pw)) issues.push('needs a lowercase letter')
  if (!/[A-Z0-9]/.test(pw)) issues.push('needs an uppercase letter or digit')
  return issues
}
