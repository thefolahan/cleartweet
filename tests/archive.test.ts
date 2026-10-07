import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildArchive, extractFromZip, parseYtdFile } from '../src/shared/archive'

const tweets = `window.YTD.tweets.part0 = ${JSON.stringify([
  { tweet: { id_str: '100', full_text: 'hello world', created_at: 'Wed Oct 10 20:19:24 +0000 2018', favorite_count: '5', retweet_count: '1' } },
  { tweet: { id_str: '200', full_text: '@a sure', in_reply_to_status_id_str: '99', created_at: 'Fri Jan 03 10:00:00 +0000 2020', favorite_count: '0' } },
  { tweet: { id_str: '300', full_text: 'RT @b: something', created_at: 'Mon Mar 01 09:00:00 +0000 2021', favorite_count: '0' } },
])}`

const headers = `window.YTD.tweet_headers.part0 = ${JSON.stringify([
  { tweet: { tweet_id: '100', user_id: '1', created_at: 'Wed Oct 10 20:19:24 +0000 2018' } },
  { tweet: { tweet_id: '400', user_id: '1', created_at: 'Tue Jun 01 09:00:00 +0000 2021' } },
])}`

describe('parseYtdFile', () => {
  it('reads the key and items', () => {
    const file = parseYtdFile(tweets)
    expect(file.key).toBe('tweets')
    expect(file.items).toHaveLength(3)
  })

  it('rejects files that are not from an archive', () => {
    expect(() => parseYtdFile('{"a":1}')).toThrow(/X data archive/)
  })
})

describe('buildArchive', () => {
  it('classifies posts, replies and reposts, newest first', () => {
    const archive = buildArchive([{ name: 'tweets.js', text: tweets }])
    expect(archive.detail).toBe('full')
    expect(archive.posts.map((p) => [p.id, p.kind])).toEqual([
      ['300', 'repost'],
      ['200', 'reply'],
      ['100', 'post'],
    ])
    expect(archive.posts[2].likes).toBe(5)
    expect(archive.posts[2].createdAt).toBe(Date.UTC(2018, 9, 10, 20, 19, 24))
  })

  it('merges headers without duplicating posts', () => {
    const archive = buildArchive([
      { name: 'tweets.js', text: tweets },
      { name: 'tweet-headers.js', text: headers },
    ])
    expect(archive.posts.map((p) => p.id).sort()).toEqual(['100', '200', '300', '400'])
    expect(archive.detail).toBe('headers')
  })

  it('ignores unrelated archive files and fails when nothing is left', () => {
    expect(() => buildArchive([{ name: 'like.js', text: 'window.YTD.like.part0 = []' }])).toThrow(/No posts found/)
  })
})

describe('extractFromZip', () => {
  it('pulls only post files out of the archive', () => {
    const zip = zipSync({
      'data/tweets.js': strToU8(tweets),
      'data/tweets-part1.js': strToU8(tweets.replace('part0', 'part1')),
      'data/like.js': strToU8('window.YTD.like.part0 = []'),
      'data/tweets_media/a.jpg': new Uint8Array([1, 2, 3]),
    })
    expect(extractFromZip(zip).map((f) => f.name).sort()).toEqual(['data/tweets-part1.js', 'data/tweets.js'])
  })
})
