/** The renderer's only door to the outside. */
import type { ImHimApi } from '@shared/api'

export const api: ImHimApi = window.api

/**
 * IPC errors arrive as "GuardError: message". A guard refusal is a rule doing
 * its job, not a fault, so the UI shows it plainly and does not treat it as a
 * crash.
 */
export interface ApiFailure {
  message: string
  isGuard: boolean
}

export function toFailure(err: unknown): ApiFailure {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron wraps the thrown message; strip its prefix and our error name.
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')
  const match = /^(\w*Error):\s*(.*)$/s.exec(cleaned)
  if (match) return { message: match[2], isGuard: match[1] === 'GuardError' }
  return { message: cleaned, isGuard: false }
}
