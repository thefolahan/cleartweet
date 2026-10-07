import type { ArchivePost, PostKind } from './types'

export interface FilterOptions {
  from?: number
  to?: number
  kinds: Record<Exclude<PostKind, 'unknown'>, boolean>
  keepWords: string[]
  keepIfLikesAtLeast?: number
  keepIds: Set<string>
}

export const defaultFilters = (): FilterOptions => ({
  kinds: { post: true, reply: true, repost: true },
  keepWords: [],
  keepIds: new Set(),
})

export function parseIdList(input: string): Set<string> {
  const ids = input.match(/\d{6,}/g) ?? []
  return new Set(ids)
}

export function shouldDelete(post: ArchivePost, f: FilterOptions): boolean {
  if (f.keepIds.has(post.id)) return false
  if (f.from !== undefined && post.createdAt < f.from) return false
  if (f.to !== undefined && post.createdAt > f.to) return false
  if (post.kind !== 'unknown' && !f.kinds[post.kind]) return false
  if (post.text && f.keepWords.length) {
    const text = post.text.toLowerCase()
    if (f.keepWords.some((w) => text.includes(w.toLowerCase()))) return false
  }
  if (f.keepIfLikesAtLeast !== undefined && (post.likes ?? 0) >= f.keepIfLikesAtLeast) return false
  return true
}

export function selectPosts(posts: ArchivePost[], f: FilterOptions): ArchivePost[] {
  return posts.filter((p) => shouldDelete(p, f))
}
