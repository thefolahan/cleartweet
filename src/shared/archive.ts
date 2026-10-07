import { unzipSync, strFromU8 } from 'fflate'
import type { Archive, ArchivePost, PostKind } from './types'

const ARCHIVE_FILE = /(?:^|\/)(tweets|tweet-headers)(?:-part\d+)?\.js$/

interface YtdFile {
  key: string
  items: unknown[]
}

export function parseYtdFile(source: string): YtdFile {
  const match = source.match(/^\s*window\.YTD\.([a-z_]+)\.part\d+\s*=\s*/)
  if (!match) throw new Error('This file does not look like part of an X data archive.')
  const items = JSON.parse(source.slice(match[0].length))
  if (!Array.isArray(items)) throw new Error('The archive file did not contain a list of posts.')
  return { key: match[1], items }
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) ? n : undefined
}

function fromTweet(raw: any): ArchivePost | null {
  const t = raw?.tweet ?? raw
  const id = t?.id_str ?? t?.id
  if (!id) return null
  const text: string = t.full_text ?? t.text ?? ''
  let kind: PostKind = 'post'
  if (text.startsWith('RT @')) kind = 'repost'
  else if (t.in_reply_to_status_id_str || t.in_reply_to_status_id) kind = 'reply'
  return {
    id: String(id),
    createdAt: Date.parse(t.created_at) || 0,
    kind,
    text,
    likes: toNumber(t.favorite_count),
    reposts: toNumber(t.retweet_count),
  }
}

function fromHeader(raw: any): ArchivePost | null {
  const t = raw?.tweet ?? raw
  if (!t?.tweet_id) return null
  return { id: String(t.tweet_id), createdAt: Date.parse(t.created_at) || 0, kind: 'unknown' }
}

export function buildArchive(files: { name: string; text: string }[]): Archive {
  const full = new Map<string, ArchivePost>()
  const headers = new Map<string, ArchivePost>()
  const sourceFiles: string[] = []

  for (const file of files) {
    const { key, items } = parseYtdFile(file.text)
    if (key === 'tweets' || key === 'tweet') {
      for (const item of items) {
        const post = fromTweet(item)
        if (post) full.set(post.id, post)
      }
    } else if (key === 'tweet_headers') {
      for (const item of items) {
        const post = fromHeader(item)
        if (post) headers.set(post.id, post)
      }
    } else {
      continue
    }
    sourceFiles.push(file.name)
  }

  if (!sourceFiles.length) {
    throw new Error('No posts found. Choose tweets.js, tweet-headers.js, or the archive zip.')
  }

  for (const [id, post] of headers) if (!full.has(id)) full.set(id, post)
  const posts = [...full.values()].sort((a, b) => b.createdAt - a.createdAt)
  const detail = posts.every((p) => p.kind !== 'unknown') ? 'full' : 'headers'
  return { posts, detail, sourceFiles }
}

export function extractFromZip(bytes: Uint8Array): { name: string; text: string }[] {
  const entries = unzipSync(bytes, { filter: (f) => ARCHIVE_FILE.test(f.name) })
  return Object.entries(entries).map(([name, data]) => ({ name, text: strFromU8(data) }))
}

export async function readArchiveFiles(files: File[]): Promise<Archive> {
  const sources: { name: string; text: string }[] = []
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      sources.push(...extractFromZip(new Uint8Array(await file.arrayBuffer())))
    } else {
      sources.push({ name: file.name, text: await file.text() })
    }
  }
  return buildArchive(sources)
}
