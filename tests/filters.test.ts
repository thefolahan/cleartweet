import { describe, expect, it } from 'vitest'
import { defaultFilters, parseIdList, selectPosts } from '../src/shared/filters'
import type { ArchivePost } from '../src/shared/types'

const posts: ArchivePost[] = [
  { id: '1', createdAt: Date.UTC(2015, 0, 1), kind: 'post', text: 'Got hired today', likes: 40 },
  { id: '2', createdAt: Date.UTC(2018, 0, 1), kind: 'reply', text: 'lol', likes: 0 },
  { id: '3', createdAt: Date.UTC(2020, 0, 1), kind: 'repost', text: 'RT @x: news', likes: 0 },
  { id: '4', createdAt: Date.UTC(2022, 0, 1), kind: 'unknown' },
]
const ids = (f: Parameters<typeof selectPosts>[1]) => selectPosts(posts, f).map((p) => p.id)

describe('selectPosts', () => {
  it('selects everything by default', () => {
    expect(ids(defaultFilters())).toEqual(['1', '2', '3', '4'])
  })

  it('applies a date range', () => {
    expect(ids({ ...defaultFilters(), from: Date.UTC(2017, 0, 1), to: Date.UTC(2021, 0, 1) })).toEqual(['2', '3'])
  })

  it('filters by type but keeps posts whose type is unknown', () => {
    expect(ids({ ...defaultFilters(), kinds: { post: false, reply: true, repost: false } })).toEqual(['2', '4'])
  })

  it('keeps posts with protected words or enough likes', () => {
    expect(ids({ ...defaultFilters(), keepWords: ['HIRED'] })).toEqual(['2', '3', '4'])
    expect(ids({ ...defaultFilters(), keepIfLikesAtLeast: 10 })).toEqual(['2', '3', '4'])
  })

  it('never selects ids on the keep list', () => {
    expect(ids({ ...defaultFilters(), keepIds: new Set(['3']) })).toEqual(['1', '2', '4'])
  })
})

describe('parseIdList', () => {
  it('reads ids out of links and loose text', () => {
    const list = parseIdList('https://x.com/me/status/1234567890123\n9876543210, short 123')
    expect([...list]).toEqual(['1234567890123', '9876543210'])
  })
})
