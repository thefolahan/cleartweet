import { describe, expect, it } from 'vitest'
import { backoff, MAX_BACKOFF_MS, nextDelay, rateLimitWait, readRateHeaders, RESET_BUFFER_MS } from '../src/shared/pacing'

const noJitter = () => 0.5
const now = 1_000_000

describe('readRateHeaders', () => {
  it('converts the reset time to milliseconds', () => {
    const headers = new Headers({ 'x-rate-limit-limit': '500', 'x-rate-limit-remaining': '12', 'x-rate-limit-reset': '1700000000' })
    expect(readRateHeaders(headers)).toEqual({ limit: 500, remaining: 12, resetAt: 1_700_000_000_000 })
  })

  it('leaves missing headers undefined', () => {
    expect(readRateHeaders(new Headers())).toEqual({ limit: undefined, remaining: undefined, resetAt: undefined })
  })
})

describe('nextDelay', () => {
  it('uses the minimum delay when X sends no limits', () => {
    expect(nextDelay(undefined, now, 1000, noJitter)).toBe(1000)
  })

  it('spreads the remaining requests across the window', () => {
    expect(nextDelay({ remaining: 10, resetAt: now + 600_000 }, now, 1000, noJitter)).toBe(60_000)
  })

  it('never goes faster than the minimum delay', () => {
    expect(nextDelay({ remaining: 1000, resetAt: now + 10_000 }, now, 1000, noJitter)).toBe(1000)
  })

  it('waits for the reset once the window is spent', () => {
    expect(nextDelay({ remaining: 0, resetAt: now + 90_000 }, now, 1000, noJitter)).toBe(90_000 + RESET_BUFFER_MS)
  })

  it('adds at most twenty percent of jitter', () => {
    expect(nextDelay(undefined, now, 1000, () => 0)).toBe(800)
    expect(nextDelay(undefined, now, 1000, () => 1)).toBe(1200)
  })
})

describe('rateLimitWait and backoff', () => {
  it('prefers the reset header', () => {
    expect(rateLimitWait({ resetAt: now + 30_000 }, now, 3)).toBe(30_000 + RESET_BUFFER_MS)
  })

  it('backs off exponentially without a reset header, up to a cap', () => {
    expect(rateLimitWait({}, now, 0)).toBe(60_000)
    expect(rateLimitWait({}, now, 2)).toBe(240_000)
    expect(backoff(20)).toBe(MAX_BACKOFF_MS)
  })
})
