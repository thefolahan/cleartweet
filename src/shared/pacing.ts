import type { RateInfo } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND
export const RESET_BUFFER_MS = 5 * SECOND
export const MAX_BACKOFF_MS = 30 * MINUTE

export function readRateHeaders(headers: Headers): RateInfo {
  const num = (name: string) => {
    const value = headers.get(name)
    if (value === null || value === '') return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  const reset = num('x-rate-limit-reset')
  return {
    limit: num('x-rate-limit-limit'),
    remaining: num('x-rate-limit-remaining'),
    resetAt: reset === undefined ? undefined : reset * SECOND,
  }
}

/**
 * Spreads the requests left in the current window evenly across the time left,
 * so the run slows down before X has to stop it instead of hitting the wall.
 */
export function nextDelay(rate: RateInfo | undefined, now: number, minDelayMs: number, random = Math.random): number {
  let delay = minDelayMs
  if (rate?.resetAt !== undefined && rate.remaining !== undefined) {
    const windowLeft = Math.max(0, rate.resetAt - now)
    if (rate.remaining <= 0) return windowLeft + RESET_BUFFER_MS
    delay = Math.max(minDelayMs, windowLeft / rate.remaining)
  }
  const jitter = 1 + (random() - 0.5) * 0.4
  return Math.round(delay * jitter)
}

export function rateLimitWait(rate: RateInfo | undefined, now: number, consecutive429: number): number {
  if (rate?.resetAt !== undefined && rate.resetAt > now) return rate.resetAt - now + RESET_BUFFER_MS
  return backoff(consecutive429, MINUTE)
}

export function backoff(attempt: number, base = 15 * SECOND): number {
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.max(0, attempt))
}
