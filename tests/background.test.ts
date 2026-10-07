import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeleteResult, Job } from '../src/shared/types'

const results: DeleteResult[] = []
vi.mock('../src/background/tabs', () => ({
  SessionError: class extends Error {},
  ensureWorkerTab: vi.fn(async () => 1),
  discoverDeleteQueryId: vi.fn(async () => 'QUERY'),
  deleteInTab: vi.fn(async () => results.shift() ?? { kind: 'deleted', rate: {} }),
}))

let store: Record<string, unknown>
let onMessage: (req: unknown, sender: unknown, reply: (r: unknown) => void) => void
let onAlarm: (alarm: { name: string }) => void
const alarms = new Map<string, number>()

function installChrome() {
  store = {}
  alarms.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) } },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(store[key]) }),
        set: async (items: Record<string, unknown>) => Object.assign(store, structuredClone(items)),
        remove: async (keys: string[]) => keys.forEach((k) => delete store[k]),
      },
      onChanged: { addListener: () => {} },
    },
    alarms: {
      create: (name: string, info: { when: number }) => alarms.set(name, info.when),
      clear: async (name: string) => alarms.delete(name),
      onAlarm: { addListener: (fn: typeof onAlarm) => (onAlarm = fn) },
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, onClicked: { addListener: () => {} } },
  }
}

const job = () => store.job as Job
const message = (type: string) => new Promise((resolve) => onMessage({ type }, { id: 'ext' }, resolve))

async function setup(ids: string[], dryRun = false) {
  const { createJob } = await import('../src/shared/storage')
  await createJob(ids, { dryRun, minDelayMs: 1000 })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.clearAllMocks()
  results.length = 0
  installChrome()
  await import('../src/background/index')
})

afterEach(() => vi.useRealTimers())

describe('background run loop', () => {
  it('works through the queue and finishes', async () => {
    await setup(['1', '2', '3'])
    await message('cleartweet:start')
    results.push({ kind: 'deleted', rate: {} }, { kind: 'gone', rate: {} }, { kind: 'deleted', rate: {} })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(job()).toMatchObject({ status: 'done', cursor: 3, deleted: 2, alreadyGone: 1, failed: 0, queryId: 'QUERY' })
  })

  it('waits for the reset through an alarm when rate limited, then carries on', async () => {
    await setup(['1', '2'])
    const resetAt = Date.now() + 15 * 60_000
    results.push({ kind: 'rate_limited', rate: { limit: 50, remaining: 0, resetAt } })
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(100)

    expect(job()).toMatchObject({ status: 'waiting', cursor: 0, consecutive429: 1 })
    expect(alarms.get('cleartweet:resume')).toBeGreaterThan(resetAt)

    vi.setSystemTime(alarms.get('cleartweet:resume')!)
    onAlarm({ name: 'cleartweet:resume' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(job()).toMatchObject({ status: 'done', deleted: 2 })
  })

  it('ignores an early wake up', async () => {
    await setup(['1', '2'])
    results.push({ kind: 'rate_limited', rate: { resetAt: Date.now() + 60 * 60_000 } })
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(100)
    onAlarm({ name: 'cleartweet:resume' })
    await vi.advanceTimersByTimeAsync(100)
    expect(job()).toMatchObject({ status: 'waiting', cursor: 0 })
  })

  it('retries errors with backoff, then skips the post and records it', async () => {
    await setup(['1', '2'])
    for (let i = 0; i < 4; i++) results.push({ kind: 'error', message: 'HTTP 500', rate: {} })
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(20_000)
    for (let i = 0; i < 3 && job().status === 'waiting'; i++) {
      vi.setSystemTime(alarms.get('cleartweet:resume')!)
      onAlarm({ name: 'cleartweet:resume' })
      await vi.advanceTimersByTimeAsync(20_000)
    }
    expect(job()).toMatchObject({ status: 'done', failed: 1, failedIds: ['1'], deleted: 1 })
  })

  it('stops on an auth problem and keeps its place', async () => {
    await setup(['1', '2'])
    results.push({ kind: 'auth', status: 401, message: 'X refused the request (401).', rate: {} })
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(5000)
    expect(job()).toMatchObject({ status: 'error', cursor: 0, lastError: 'X refused the request (401).' })
  })

  it('looks up the delete operation again when X renames it', async () => {
    const tabs = await import('../src/background/tabs')
    await setup(['1'])
    results.push({ kind: 'stale_query', rate: {} })
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(5000)
    expect(tabs.discoverDeleteQueryId).toHaveBeenCalledTimes(2)
    expect(job()).toMatchObject({ status: 'done', deleted: 1 })
  })

  it('pauses without losing a request that was in flight', async () => {
    await setup(['1', '2', '3'])
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(10)
    await message('cleartweet:pause')
    const paused = job()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(job()).toMatchObject({ status: 'paused', cursor: paused.cursor })
    expect(paused.cursor).toBeGreaterThan(0)
  })

  it('does not call X during a dry run', async () => {
    const tabs = await import('../src/background/tabs')
    await setup(['1', '2'], true)
    await message('cleartweet:start')
    await vi.advanceTimersByTimeAsync(5000)
    expect(tabs.deleteInTab).not.toHaveBeenCalled()
    expect(job()).toMatchObject({ status: 'done', deleted: 2 })
  })
})
