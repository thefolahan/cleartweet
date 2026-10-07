import type { ContentRequest, DeleteResult, PingReply } from '../shared/types'

const X_TABS = ['https://x.com/*', 'https://twitter.com/*']
const FALLBACK_QUERY_ID = 'VaenaVgh5q5ih7kvyVjgtg'
const DELETE_OPERATION = /queryId:\s*"([\w-]+)",\s*operationName:\s*"DeleteTweet"/

export class SessionError extends Error {}

let workerTab: number | undefined

function send<T>(tabId: number, message: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>
}

async function ping(tabId: number): Promise<PingReply | undefined> {
  try {
    return await send<PingReply>(tabId, { type: 'clearpost:ping' })
  } catch {
    return undefined
  }
}

function waitForLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timeout)
      resolve()
    }
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === 'complete') done()
    }
    const timeout = setTimeout(done, timeoutMs)
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function usable(tabId: number): Promise<boolean> {
  const reply = await ping(tabId)
  if (!reply) return false
  if (!reply.loggedIn) throw new SessionError('Log in to X in this browser, then resume.')
  workerTab = tabId
  return true
}

/** Finds an open X tab that can carry requests, injecting the content script or opening a tab if needed. */
export async function ensureWorkerTab(): Promise<number> {
  if (workerTab !== undefined && (await usable(workerTab))) return workerTab
  workerTab = undefined

  const tabs = (await chrome.tabs.query({ url: X_TABS })).filter((t) => t.id !== undefined && !t.discarded)
  for (const tab of tabs) if (await usable(tab.id!)) return tab.id!

  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['content.js'] })
      if (await usable(tab.id!)) return tab.id!
    } catch {
      // The tab may be on an error page or still loading; try the next one.
    }
  }

  const tab = await chrome.tabs.create({ url: 'https://x.com/home', active: false })
  await waitForLoad(tab.id!)
  if (await usable(tab.id!)) return tab.id!
  throw new SessionError('Could not reach X. Open x.com in a tab, log in, then resume.')
}

export function deleteInTab(tabId: number, id: string, queryId: string): Promise<DeleteResult> {
  return send<DeleteResult>(tabId, { type: 'clearpost:delete', id, queryId })
}

/**
 * X renames its GraphQL operations whenever it ships a new web client, so the id for DeleteTweet
 * is read from the bundles the page has loaded. The last known id is the fallback.
 */
export async function discoverDeleteQueryId(tabId: number): Promise<string> {
  const urls = await send<string[]>(tabId, { type: 'clearpost:scripts' }).catch(() => [] as string[])
  const ranked = urls
    .filter((u) => u.includes('/responsive-web/'))
    .sort((a, b) => Number(b.includes('/main.')) - Number(a.includes('/main.')))
  for (const url of ranked.slice(0, 30)) {
    try {
      const match = (await (await fetch(url)).text()).match(DELETE_OPERATION)
      if (match) return match[1]
    } catch {
      // A bundle that fails to load is skipped.
    }
  }
  return FALLBACK_QUERY_ID
}
