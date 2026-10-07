import { backoff, nextDelay, rateLimitWait } from '../shared/pacing'
import { addLog, clearJob, getJob, getQueue, replaceQueue, saveJob } from '../shared/storage'
import type { BackgroundRequest, DeleteResult, Job } from '../shared/types'
import { deleteInTab, discoverDeleteQueryId, ensureWorkerTab, SessionError } from './tabs'

const ALARM = 'clearpost:resume'
// Service workers are stopped after about 30 seconds of quiet, so longer waits go through an alarm.
const TIMER_LIMIT_MS = 25_000
const MAX_ATTEMPTS = 4

let timer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<unknown> = Promise.resolve()

/** Runs job mutations one at a time so a pause can never be overwritten by a request in flight. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn)
  chain = next.catch(() => undefined)
  return next
}

function schedule(job: Job, delayMs: number, reason?: string): void {
  clearTimeout(timer)
  job.waitUntil = Date.now() + delayMs
  if (delayMs <= TIMER_LIMIT_MS) {
    job.status = 'running'
    job.waitReason = undefined
    chrome.alarms.clear(ALARM)
    timer = setTimeout(() => void tick(), delayMs)
  } else {
    job.status = 'waiting'
    job.waitReason = reason
    chrome.alarms.create(ALARM, { when: job.waitUntil })
  }
}

function stopTimers(): void {
  clearTimeout(timer)
  chrome.alarms.clear(ALARM)
}

function settleActiveTime(job: Job): void {
  if (job.activeSince) job.activeMs += Date.now() - job.activeSince
  job.activeSince = undefined
}

function updateBadge(job: Job | undefined): void {
  if (!job || job.status === 'done') {
    chrome.action.setBadgeText({ text: job?.status === 'done' ? '✓' : '' })
    return
  }
  const pct = job.total ? Math.floor((job.cursor / job.total) * 100) : 0
  chrome.action.setBadgeText({ text: job.status === 'paused' ? '||' : `${pct}%` })
  chrome.action.setBadgeBackgroundColor({ color: job.status === 'error' ? '#d93025' : '#1d9bf0' })
}

async function persist(job: Job): Promise<void> {
  await saveJob(job)
  updateBadge(job)
}

function tick(): Promise<void> {
  return exclusive(step).catch((err) => console.error('[clearpost]', err))
}

async function step(): Promise<void> {
  const job = await getJob()
  if (!job || (job.status !== 'running' && job.status !== 'waiting')) return

  // A duplicate wake up (alarm plus timer, or a restarted worker) must not shorten the wait.
  const early = (job.waitUntil ?? 0) - Date.now()
  if (early > 500) {
    schedule(job, early, job.waitReason)
    return
  }

  const queue = await getQueue()
  if (job.cursor >= queue.length) {
    job.status = 'done'
    job.waitUntil = undefined
    settleActiveTime(job)
    addLog(job, 'info', `Finished. ${job.deleted} deleted, ${job.alreadyGone} already gone, ${job.failed} failed.`)
    await persist(job)
    return
  }

  const id = queue[job.cursor]
  let result: DeleteResult
  if (job.dryRun) {
    result = { kind: 'deleted', rate: {} }
  } else {
    let tabId: number
    try {
      tabId = await ensureWorkerTab()
    } catch (err) {
      const message = err instanceof SessionError ? err.message : String(err)
      job.status = 'error'
      job.lastError = message
      settleActiveTime(job)
      addLog(job, 'error', message)
      await persist(job)
      return
    }
    if (!job.queryId) {
      job.queryId = await discoverDeleteQueryId(tabId)
      addLog(job, 'info', `Using DeleteTweet operation ${job.queryId}.`)
    }
    try {
      result = await deleteInTab(tabId, id, job.queryId)
    } catch (err) {
      // The tab navigated or closed while the request was in flight.
      result = { kind: 'error', message: `Lost the X tab: ${String(err)}`, rate: {} }
    }
  }

  applyResult(job, id, result)
  await persist(job)
}

function applyResult(job: Job, id: string, result: DeleteResult): void {
  const now = Date.now()
  job.rate = Object.keys(result.rate).length ? result.rate : job.rate
  job.lastError = undefined

  const advance = () => {
    job.cursor++
    job.attempt = 0
    job.consecutive429 = 0
    schedule(job, nextDelay(result.rate, now, job.minDelayMs), 'Pacing to stay inside the rate limit')
  }

  switch (result.kind) {
    case 'deleted':
      job.deleted++
      advance()
      break
    case 'gone':
      job.alreadyGone++
      advance()
      break
    case 'rate_limited': {
      job.consecutive429++
      const wait = rateLimitWait(result.rate, now, job.consecutive429 - 1)
      addLog(job, 'warn', `Rate limit reached. Waiting ${Math.ceil(wait / 60_000)} min before continuing.`)
      schedule(job, wait, 'X rate limit reached')
      break
    }
    case 'stale_query':
      if (job.attempt === 0) {
        job.attempt++
        job.queryId = undefined
        addLog(job, 'warn', 'X changed its API. Looking up the new delete operation.')
        schedule(job, 1000)
        break
      }
      fail(job, id, 'Delete operation not found (404)')
      break
    case 'auth':
      job.status = 'error'
      job.waitUntil = undefined
      job.lastError = result.message
      settleActiveTime(job)
      addLog(job, 'error', result.message)
      break
    case 'error':
      fail(job, id, result.message)
      break
  }
}

function fail(job: Job, id: string, message: string): void {
  job.attempt++
  if (job.attempt < MAX_ATTEMPTS) {
    const wait = backoff(job.attempt - 1)
    addLog(job, 'warn', `Post ${id}: ${message}. Retrying in ${Math.round(wait / 1000)} s.`)
    schedule(job, wait, 'Retrying after an error')
    return
  }
  job.failed++
  job.failedIds.push(id)
  job.cursor++
  job.attempt = 0
  addLog(job, 'error', `Post ${id}: ${message}. Skipped after ${MAX_ATTEMPTS} attempts.`)
  schedule(job, job.minDelayMs)
}

async function handle(request: BackgroundRequest): Promise<void> {
  const job = await getJob()
  if (request.type === 'clearpost:cancel') {
    stopTimers()
    await clearJob()
    updateBadge(undefined)
    return
  }
  if (!job) return

  switch (request.type) {
    case 'clearpost:start':
    case 'clearpost:resume':
      if (job.status === 'running' || job.status === 'waiting' || job.status === 'done') return
      job.activeSince = Date.now()
      job.attempt = 0
      addLog(job, 'info', job.cursor === 0 ? `Started${job.dryRun ? ' a dry run' : ''}.` : 'Resumed.')
      schedule(job, 0)
      break
    case 'clearpost:pause':
      if (job.status !== 'running' && job.status !== 'waiting') return
      stopTimers()
      job.status = 'paused'
      job.waitUntil = undefined
      settleActiveTime(job)
      addLog(job, 'info', 'Paused.')
      break
    case 'clearpost:retry_failed': {
      if (!job.failedIds.length) return
      const queue = await getQueue()
      await replaceQueue([...queue, ...job.failedIds])
      addLog(job, 'info', `Queued ${job.failedIds.length} failed posts for another attempt.`)
      job.total += job.failedIds.length
      job.failed = 0
      job.failedIds = []
      job.activeSince = Date.now()
      schedule(job, 0)
      break
    }
  }
  await persist(job)
}

chrome.runtime.onMessage.addListener((request: BackgroundRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !request?.type?.startsWith('clearpost:')) return false
  exclusive(() => handle(request)).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String(err) }),
  )
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick()
})

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html')
  const [existing] = await chrome.tabs.query({ url })
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url })
  }
})

// Timers do not survive the worker being stopped, so every wake up picks the job back up.
void exclusive(async () => {
  const job = await getJob()
  updateBadge(job)
  if (job && (job.status === 'running' || job.status === 'waiting')) {
    schedule(job, Math.max(0, (job.waitUntil ?? 0) - Date.now()), job.waitReason)
    await saveJob(job)
  }
})
