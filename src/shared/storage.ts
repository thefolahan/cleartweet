import type { Job, LogEntry } from './types'

const JOB = 'job'
const QUEUE = 'queue'
const LOG_LIMIT = 200

export async function getJob(): Promise<Job | undefined> {
  const { [JOB]: job } = await chrome.storage.local.get(JOB)
  return job as Job | undefined
}

export async function saveJob(job: Job): Promise<void> {
  await chrome.storage.local.set({ [JOB]: job })
}

export async function getQueue(): Promise<string[]> {
  const { [QUEUE]: queue } = await chrome.storage.local.get(QUEUE)
  return (queue as string[] | undefined) ?? []
}

export async function createJob(ids: string[], options: { dryRun: boolean; minDelayMs: number }): Promise<Job> {
  const job: Job = {
    status: 'paused',
    total: ids.length,
    cursor: 0,
    deleted: 0,
    alreadyGone: 0,
    failed: 0,
    failedIds: [],
    dryRun: options.dryRun,
    minDelayMs: options.minDelayMs,
    createdAt: Date.now(),
    activeMs: 0,
    attempt: 0,
    consecutive429: 0,
    log: [],
  }
  await chrome.storage.local.set({ [QUEUE]: ids, [JOB]: job })
  return job
}

export async function replaceQueue(ids: string[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE]: ids })
}

export async function clearJob(): Promise<void> {
  await chrome.storage.local.remove([JOB, QUEUE])
}

export function addLog(job: Job, level: LogEntry['level'], message: string): void {
  job.log.push({ at: Date.now(), level, message })
  if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT)
}

export function onJobChange(listener: (job: Job | undefined) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && JOB in changes) listener(changes[JOB].newValue as Job | undefined)
  })
}
