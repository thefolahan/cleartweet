import { readRateHeaders } from '../shared/pacing'
import type { DeleteResult } from '../shared/types'

// The public token the X web client sends with every request. It identifies the app, not the user;
// the user is identified by the session cookies the browser attaches.
const WEB_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const TIMEOUT_MS = 15_000

export function getCookie(name: string): string | null {
  const match = `; ${document.cookie}`.match(new RegExp(`;\\s*${name}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

function transactionId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(94)), (b) => alphabet[b % alphabet.length]).join('')
}

export async function deletePost(id: string, queryId: string): Promise<DeleteResult> {
  const csrf = getCookie('ct0')
  if (!csrf) return { kind: 'auth', status: 0, message: 'You are not logged in to X in this browser.', rate: {} }

  let response: Response
  try {
    response = await fetch(`${location.origin}/i/api/graphql/${queryId}/DeleteTweet`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        authorization: WEB_BEARER,
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'x-client-transaction-id': transactionId(),
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
      },
      body: JSON.stringify({ variables: { tweet_id: id, dark_request: false }, queryId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof DOMException && err.name === 'TimeoutError' ? 'Request timed out' : String(err)
    return { kind: 'error', message, rate: {} }
  }

  const rate = readRateHeaders(response.headers)
  if (response.status === 429) return { kind: 'rate_limited', rate }
  if (response.status === 401 || response.status === 403) {
    return { kind: 'auth', status: response.status, message: `X refused the request (${response.status}).`, rate }
  }
  if (response.status === 404) return { kind: 'stale_query', rate }
  if (!response.ok) return { kind: 'error', status: response.status, message: `HTTP ${response.status}`, rate }

  const body = await response.json().catch(() => null)
  const errors: { code?: number; message?: string }[] = body?.errors ?? []
  if (errors.length) {
    const { code, message = 'Unknown error' } = errors[0]
    // 144: no status found with that id, so it is already gone or was never yours to delete.
    if (code === 144 || /no status found/i.test(message)) return { kind: 'gone', rate }
    if (code === 88) return { kind: 'rate_limited', rate }
    if (code === 326 || code === 64 || code === 32) return { kind: 'auth', status: 200, message, rate }
    return { kind: 'error', status: 200, message: code ? `${message} (code ${code})` : message, rate }
  }
  return { kind: 'deleted', rate }
}
