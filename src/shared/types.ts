export type PostKind = 'post' | 'reply' | 'repost' | 'unknown'

export interface ArchivePost {
  id: string
  createdAt: number
  kind: PostKind
  text?: string
  likes?: number
  reposts?: number
}

export type ArchiveDetail = 'full' | 'headers'

export interface Archive {
  posts: ArchivePost[]
  detail: ArchiveDetail
  sourceFiles: string[]
}

export interface RateInfo {
  limit?: number
  remaining?: number
  resetAt?: number
}

export type JobStatus = 'running' | 'waiting' | 'paused' | 'done' | 'error'

export interface LogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface Job {
  status: JobStatus
  total: number
  cursor: number
  deleted: number
  alreadyGone: number
  failed: number
  failedIds: string[]
  dryRun: boolean
  minDelayMs: number
  createdAt: number
  activeSince?: number
  activeMs: number
  waitUntil?: number
  waitReason?: string
  lastError?: string
  rate?: RateInfo
  attempt: number
  consecutive429: number
  queryId?: string
  log: LogEntry[]
}

export type DeleteResult =
  | { kind: 'deleted'; rate: RateInfo }
  | { kind: 'gone'; rate: RateInfo }
  | { kind: 'rate_limited'; rate: RateInfo }
  | { kind: 'stale_query'; rate: RateInfo }
  | { kind: 'auth'; status: number; message: string; rate: RateInfo }
  | { kind: 'error'; status?: number; message: string; rate: RateInfo }

export type ContentRequest =
  | { type: 'clearpost:ping' }
  | { type: 'clearpost:scripts' }
  | { type: 'clearpost:delete'; id: string; queryId: string }

export interface PingReply {
  ok: true
  loggedIn: boolean
}

export type BackgroundRequest =
  | { type: 'clearpost:start' }
  | { type: 'clearpost:pause' }
  | { type: 'clearpost:resume' }
  | { type: 'clearpost:cancel' }
  | { type: 'clearpost:retry_failed' }
