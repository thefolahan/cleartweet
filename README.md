# Clearpost

A Chrome extension that deletes your posts on X using your data archive. It paces itself against the rate limit, so a run of many thousands of posts can go on unattended for hours or days and resume after Chrome restarts.

## Why it exists

Console scripts such as [tweetXer](https://github.com/lucahammer/tweetXer) delete posts quickly, but X added a stricter rate limit in 2026, so they stall on large accounts. A pasted script also forgets everything when the tab closes. Clearpost keeps its queue in extension storage, reads the rate limit headers on every response, and slows down before it is blocked.

## How it works

```
Dashboard (extension page)       Service worker                    Content script on x.com
  reads archive locally   ──►    owns the queue and the pace   ──►  sends DeleteTweet with the
  filters, previews, starts      persists progress every post       session of the logged in user
                                 alarms for long waits         ◄──  returns result and rate headers
```

* **Archive parsing.** Accepts the archive zip, `tweets.js` (full detail) or `tweet-headers.js` (ids and dates only). The zip is opened in the browser with fflate and only the post files are decompressed.
* **Filters.** Date range, type (post, reply, repost), protected words, a like threshold and a list of posts that must never be deleted. A preview shows what will go.
* **Adaptive pacing.** After each request the worker reads `x-rate-limit-remaining` and `x-rate-limit-reset` and spreads the requests left evenly across the time left in the window. When the window is spent, or X answers 429, it waits for the reset.
* **Durable waits.** Chrome stops idle service workers after about 30 seconds, so short gaps use a timer and long waits use `chrome.alarms`. Every wake up reloads the job from storage, so nothing is lost when the worker or the browser restarts.
* **Serialised state.** All job changes run through one queue in the worker, so pressing Pause while a request is in flight cannot be overwritten by its result.
* **Self healing API calls.** X renames its GraphQL operation ids with each web release. The worker reads the current `DeleteTweet` id from the loaded bundles and looks it up again if a request returns 404.
* **Failure handling.** Network and server errors are retried with exponential backoff, then the post is set aside for a later retry. Authentication problems stop the run and keep its place.
* **Dry run.** Walks the whole queue without calling X, which is useful for testing filters and for demos.

## Getting started

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select the `dist` folder.
2. Log in to x.com in the same browser.
3. Click the Clearpost icon, drop your archive, choose filters and start.

Use `npm run watch` while developing and press reload on the extensions page after each change.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | Bundle into `dist` |
| `npm run watch` | Rebuild on change with source maps |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Type check the project |
| `npm run zip` | Build and package `clearpost.zip` |

## Project layout

```
src/
  background/   service worker: run loop, pacing, tab management
  content/      runs on x.com and performs the authenticated request
  dashboard/    extension page: archive loading, filters, live progress
  shared/       archive parser, filters, pacing maths, storage helpers
tests/          unit tests, including the run loop against a fake chrome API
scripts/        icon generator
```

## Disclaimer

This tool calls the same private endpoint the X web app uses. Automating it may breach the X terms of service and could lead to account limits. Deleted posts cannot be recovered. Use it at your own risk and only on your own account.
