import type { ContentRequest, PingReply } from '../shared/types'
import { deletePost, getCookie } from './x-api'

declare global {
  interface Window {
    __clearpostLoaded?: boolean
  }
}

// The background worker may inject this file into a tab that already received it from the manifest.
if (!window.__clearpostLoaded) {
  window.__clearpostLoaded = true

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    switch (message?.type) {
      case 'clearpost:ping': {
        const reply: PingReply = { ok: true, loggedIn: Boolean(getCookie('ct0')) }
        sendResponse(reply)
        return false
      }
      case 'clearpost:scripts': {
        const urls = Array.from(document.scripts, (s) => s.src).filter((src) => src.includes('abs.twimg.com'))
        const preloads = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href*="abs.twimg.com"]'), (l) => l.href)
        const loaded = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((name) => name.includes('abs.twimg.com') && name.endsWith('.js'))
        sendResponse([...new Set([...urls, ...preloads, ...loaded])].filter((u) => u.endsWith('.js')))
        return false
      }
      case 'clearpost:delete':
        deletePost(message.id, message.queryId).then(sendResponse)
        return true
    }
    return false
  })
}
