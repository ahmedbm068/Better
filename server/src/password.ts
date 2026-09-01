/**
 * Password hashing.
 *
 * PBKDF2-SHA256 through WebCrypto, because that is what a Worker has. bcrypt,
 * scrypt and argon2 all need native code or a WASM bundle, and none is worth
 * shipping here when PBKDF2 at a high iteration count is accepted practice.
 *
 * The iteration count is stored beside each hash rather than fixed in code, so
 * it can be raised later and old passwords keep working until their owners next
 * sign in — at which point they are silently rehashed at the new cost.
 */
/**
 * The most Cloudflare will run: it refuses anything above 100,000 outright.
 *
 * Below the 210,000 OWASP suggests for PBKDF2-SHA256, and worth being plain
 * about — this is a platform ceiling, not a judgement call. Two things take
 * some of the weight off it: an account cannot exist without a provider
 * sign-up first, and eight wrong guesses lock it for fifteen minutes. The
 * count is stored per row, so raising it later costs nothing but a deploy.
 */
export const ITERATIONS = 100_000
const KEY_BITS = 256
const SALT_BYTES = 16

export interface PasswordRecord {
  hash: string
  salt: string
  iterations: number
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)))

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS
  )
  return toHex(bits)
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return {
    hash: await derive(password, salt, ITERATIONS),
    salt: toHex(salt.buffer),
    iterations: ITERATIONS
  }
}

/**
 * Compares in constant time.
 *
 * A plain `===` on hex strings leaks how many leading characters matched, which
 * over enough attempts is enough to reconstruct the hash.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(
  password: string,
  record: PasswordRecord
): Promise<boolean> {
  const candidate = await derive(password, fromHex(record.salt), record.iterations)
  return sameSecret(candidate, record.hash)
}

/** What a password has to clear. Deliberately about length, not punctuation. */
export const MIN_PASSWORD_LENGTH = 10

export function rejectWeakPassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'password must be text'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password.length > 512) return 'password is too long'
  // Composition rules push people towards Passw0rd! and no further. Length is
  // what actually costs an attacker time.
  return null
}
