import { readArchiveFiles } from '../shared/archive'
import { defaultFilters, parseIdList, selectPosts, type FilterOptions } from '../shared/filters'
import { createJob, getJob, onJobChange } from '../shared/storage'
import type { Archive, ArchivePost, BackgroundRequest, Job } from '../shared/types'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const fmt = new Intl.NumberFormat()
const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const KIND_LABEL = { post: 'Post', reply: 'Reply', repost: 'Repost', unknown: 'Post' } as const

let archive: Archive | undefined
let selection: ArchivePost[] = []
let currentJob: Job | undefined

function send(request: BackgroundRequest) {
  return chrome.runtime.sendMessage(request)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function stat(value: number | string, label: string, tone = '') {
  return el('div', { className: `stat ${tone}` }, [el('b', { textContent: typeof value === 'number' ? fmt.format(value) : value }), el('span', { textContent: label })])
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} d ${h} h`
  if (h) return `${h} h ${m} min`
  if (m) return `${m} min ${s % 60} s`
  return `${s} s`
}

/* Setup */

async function loadFiles(files: File[]) {
  if (!files.length) return
  const status = $('load-status')
  status.textContent = 'Reading your archive...'
  try {
    archive = await readArchiveFiles(files)
    status.textContent = `Loaded ${fmt.format(archive.posts.length)} posts from ${archive.sourceFiles.join(', ')}.`
    renderSummary(archive)
    $('filters-card').hidden = false
    refreshSelection()
  } catch (err) {
    archive = undefined
    $('filters-card').hidden = true
    status.textContent = err instanceof Error ? err.message : String(err)
  }
}

function renderSummary(a: Archive) {
  const count = (kind: ArchivePost['kind']) => a.posts.filter((p) => p.kind === kind).length
  const dates = a.posts.map((p) => p.createdAt).filter(Boolean)
  const range = dates.length ? `${new Date(Math.min(...dates)).getFullYear()} to ${new Date(Math.max(...dates)).getFullYear()}` : 'Unknown'
  const summary = $('summary')
  summary.replaceChildren(stat(a.posts.length, 'in archive'))
  if (a.detail === 'full') summary.append(stat(count('post'), 'posts'), stat(count('reply'), 'replies'), stat(count('repost'), 'reposts'))
  summary.append(stat(range, 'date range'))

  $('headers-note').hidden = a.detail === 'full'
  $('filters').classList.toggle('disabled-rich', a.detail !== 'full')
}

function renderYears(all: ArchivePost[], selected: ArchivePost[]) {
  const byYear = (posts: ArchivePost[]) => {
    const map = new Map<number, number>()
    for (const p of posts) if (p.createdAt) map.set(new Date(p.createdAt).getFullYear(), (map.get(new Date(p.createdAt).getFullYear()) ?? 0) + 1)
    return map
  }
  const total = byYear(all)
  const chosen = byYear(selected)
  const years = [...total.keys()].sort()
  const max = Math.max(1, ...total.values())
  $('years').replaceChildren(
    ...years.map((year) => {
      const bar = el('div', { title: `${year}: ${fmt.format(chosen.get(year) ?? 0)} of ${fmt.format(total.get(year)!)} selected` }, [
        el('span', { textContent: years.length > 12 ? `'${String(year).slice(2)}` : String(year) }),
      ])
      bar.style.height = `${Math.max(4, (total.get(year)! / max) * 100)}%`
      bar.classList.toggle('on', (chosen.get(year) ?? 0) > 0)
      return bar
    }),
  )
}

function readFilters(): FilterOptions & { order: 'newest' | 'oldest' } {
  const form = new FormData($<HTMLFormElement>('filters'))
  const day = (name: string, end = false) => {
    const value = form.get(name) as string
    if (!value) return undefined
    const t = new Date(`${value}T00:00:00`).getTime()
    return end ? t + 86_400_000 - 1 : t
  }
  const likes = form.get('keepLikes') as string
  return {
    ...defaultFilters(),
    from: day('from'),
    to: day('to', true),
    kinds: { post: form.has('post'), reply: form.has('reply'), repost: form.has('repost') },
    keepWords: String(form.get('keepWords') ?? '').split(',').map((w) => w.trim()).filter(Boolean),
    keepIfLikesAtLeast: likes === '' ? undefined : Number(likes),
    keepIds: parseIdList(String(form.get('keepIds') ?? '')),
    order: form.get('order') === 'oldest' ? 'oldest' : 'newest',
  }
}

function refreshSelection() {
  if (!archive) return
  const filters = readFilters()
  selection = selectPosts(archive.posts, filters)
  if (filters.order === 'oldest') selection.reverse()

  $('selected-count').textContent = `${fmt.format(selection.length)} of ${fmt.format(archive.posts.length)} posts will be deleted`
  renderYears(archive.posts, selection)
  $('sample').replaceChildren(
    ...selection.slice(0, 50).map((p) =>
      el('li', {}, [
        el('span', { textContent: p.createdAt ? dateFmt.format(p.createdAt) : 'Unknown date' }),
        el('span', { className: 'kind', textContent: KIND_LABEL[p.kind] }),
        el('span', { className: 'text', textContent: p.text ?? `Post ${p.id}`, title: p.text ?? '' }),
      ]),
    ),
  )
  updateStartButton()
}

function updateStartButton() {
  const dry = $<HTMLInputElement>('dry-run').checked
  const confirmed = $<HTMLInputElement>('confirm').checked
  const start = $<HTMLButtonElement>('start')
  start.disabled = !selection.length || (!dry && !confirmed)
  start.textContent = dry ? `Start dry run of ${fmt.format(selection.length)} posts` : `Delete ${fmt.format(selection.length)} posts`
}

async function startJob() {
  const start = $<HTMLButtonElement>('start')
  start.disabled = true
  await createJob(
    selection.map((p) => p.id),
    { dryRun: $<HTMLInputElement>('dry-run').checked, minDelayMs: Number($<HTMLSelectElement>('pace').value) },
  )
  await send({ type: 'clearpost:start' })
  render(await getJob())
}

/* Run */

function render(job: Job | undefined) {
  currentJob = job
  $('setup').hidden = Boolean(job)
  $('run').hidden = !job
  if (!job) return

  const pct = job.total ? (job.cursor / job.total) * 100 : 0
  $('bar-fill').style.width = `${pct}%`

  const titles: Record<Job['status'], string> = {
    running: job.dryRun ? 'Dry run in progress' : 'Deleting your posts',
    waiting: 'Waiting for X',
    paused: 'Paused',
    done: job.dryRun ? 'Dry run complete' : 'All done',
    error: 'Stopped',
  }
  $('run-title').textContent = titles[job.status]
  const pill = $('run-state')
  pill.className = `pill ${job.status}`
  pill.textContent = job.dryRun ? `${job.status} (dry run)` : job.status

  $('run-stats').replaceChildren(
    stat(job.deleted, job.dryRun ? 'would delete' : 'deleted', 'ok'),
    stat(job.alreadyGone, 'already gone'),
    stat(job.failed, 'failed', job.failed ? 'danger' : ''),
    stat(job.total - job.cursor, 'remaining'),
  )

  const toggle = $<HTMLButtonElement>('toggle')
  toggle.hidden = job.status === 'done'
  toggle.textContent = job.status === 'running' || job.status === 'waiting' ? 'Pause' : 'Resume'
  $('retry').hidden = !job.failedIds.length || job.status === 'running' || job.status === 'waiting'
  $('reset').textContent = job.status === 'done' ? 'Start a new run' : 'Start over'

  $('log').replaceChildren(
    ...job.log
      .slice()
      .reverse()
      .map((entry) => el('li', { className: entry.level }, [el('time', { textContent: timeFmt.format(entry.at) }), el('span', { textContent: entry.message })])),
  )
  renderLive()
}

/** Parts that change every second: countdown, elapsed time, estimate. */
function renderLive() {
  const job = currentJob
  if (!job) return
  const now = Date.now()
  const processed = job.cursor
  const active = job.activeMs + (job.activeSince ? now - job.activeSince : 0)

  let detail = `${fmt.format(job.cursor)} of ${fmt.format(job.total)} processed.`
  if (job.status === 'waiting' && job.waitUntil) {
    detail = `${job.waitReason ?? 'Waiting'}. Continuing in ${duration(job.waitUntil - now)}, at ${timeFmt.format(job.waitUntil)}.`
  } else if (job.status === 'error') {
    detail = job.lastError ?? 'Something went wrong.'
  } else if (job.status === 'paused') {
    detail = `Paused after ${fmt.format(job.cursor)} of ${fmt.format(job.total)}. Resume whenever you are ready.`
  }
  $('run-detail').textContent = detail

  const facts: [string, string][] = [['Time spent', duration(active)]]
  if (processed > 0 && job.status !== 'done') {
    facts.push(['Estimated time left', duration((active / processed) * (job.total - processed))])
  }
  if (job.rate?.limit !== undefined && job.rate.remaining !== undefined) {
    facts.push(['Rate limit', `${fmt.format(job.rate.remaining)} of ${fmt.format(job.rate.limit)} requests left in this window`])
  }
  if (job.rate?.resetAt) facts.push(['Window resets', timeFmt.format(job.rate.resetAt)])
  if (job.queryId) facts.push(['Delete operation', job.queryId])
  $('facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]))
}

/* Wiring */

const drop = $('drop')
const fileInput = $<HTMLInputElement>('file')
fileInput.addEventListener('change', () => loadFiles([...(fileInput.files ?? [])]))
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  loadFiles([...(e.dataTransfer?.files ?? [])])
})

$('filters').addEventListener('input', refreshSelection)
$('filters').addEventListener('submit', (e) => e.preventDefault())
$('dry-run').addEventListener('change', updateStartButton)
$('confirm').addEventListener('change', updateStartButton)
$('start').addEventListener('click', startJob)

$('toggle').addEventListener('click', () => {
  const active = currentJob?.status === 'running' || currentJob?.status === 'waiting'
  send({ type: active ? 'clearpost:pause' : 'clearpost:resume' })
})
$('retry').addEventListener('click', () => send({ type: 'clearpost:retry_failed' }))
$('reset').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement
  if (currentJob?.status !== 'done' && button.dataset.armed !== 'true') {
    button.dataset.armed = 'true'
    button.textContent = 'Click again to discard this run'
    setTimeout(() => {
      button.dataset.armed = ''
      render(currentJob)
    }, 4000)
    return
  }
  button.dataset.armed = ''
  await send({ type: 'clearpost:cancel' })
})

onJobChange(render)
getJob().then(render)
setInterval(renderLive, 1000)
