// The sidebar panel: a frame Orca themes through `--orca-*` variables. It asks the worker for the
// focused workspace's changes and draws them grouped by category.
import { branchVersions } from '../src/branch'
import { CATEGORIES } from '../src/categories'
import { createRefresher } from '../src/refresher'
import { formatShare } from '../src/share'
import type {
  CategoryGroup,
  CategoryId,
  ChangedFile,
  ChangesAnswer,
  ChangesSnapshot,
  FileStatus
} from '../src/protocol'

type OkSnapshot = Extract<ChangesSnapshot, { state: 'ok' }>

const STATUS_NAMES: Record<FileStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Untracked'
}

const state = {
  snapshot: null as ChangesSnapshot | null,
  open: new Set<CategoryId>()
}

const numbers = new Intl.NumberFormat(orca.locale || undefined)
const fmt = (n: number) => numbers.format(n)

// ---------- DOM helpers ----------

type Attrs = Record<string, string | number | boolean | undefined | ((event: Event) => void)>

function h(
  tag: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value)
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child)
  return el
}

function svg(paths: string, size = 14): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('width', String(size))
  el.setAttribute('height', String(size))
  el.setAttribute('viewBox', '0 0 24 24')
  el.setAttribute('fill', 'none')
  el.setAttribute('stroke', 'currentColor')
  el.setAttribute('stroke-width', '2')
  el.setAttribute('stroke-linecap', 'round')
  el.setAttribute('stroke-linejoin', 'round')
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = paths
  return el
}

const ICON_CHEVRON = '<path d="M9 6l6 6-6 6"/>'
const ICON_BRANCH =
  '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7"/><path d="M18 10.5c0 4-6 3-11 5.5"/>'
const ICON_FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
const ICON_SERVER =
  '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'
/** The panel's breakdown bar, empty: an outline with faint dividers. */
const ICON_EMPTY_BAR =
  '<rect x="1" y="6.5" width="22" height="11" rx="5.5"/><path d="M10 9v6M15 9v6M19 9v6" stroke-width="1.5" stroke-opacity="0.5"/>'
const ICON_ALERT = '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16h.01"/>'
const ICON_FILE = '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'

// ---------- Pieces ----------

function lineCounts(added: number | null, deleted: number | null, small = false): HTMLElement {
  const cls = small ? 'counts small' : 'counts'
  if (added === null && deleted === null) return h('span', { class: cls + ' muted' }, 'binary')
  return h(
    'span',
    { class: cls },
    added ? h('span', { class: 'add' }, '+' + fmt(added)) : null,
    deleted ? h('span', { class: 'del' }, '−' + fmt(deleted)) : null
  )
}

function fileRow(file: ChangedFile, workspaceId: string): HTMLElement {
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const dir = slash === -1 ? '' : file.path.slice(0, slash)
  const deleted = file.status === 'D'
  const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path
  const content = [
    svg(ICON_FILE),
    h('span', { class: 'name' }, name),
    h('span', { class: 'dir' }, dir),
    lineCounts(file.added, file.deleted, true),
    h(
      'span',
      { class: `status s-${file.status}`, title: STATUS_NAMES[file.status] },
      h('span', { 'aria-hidden': 'true' }, file.status),
      h('span', { class: 'sr-only' }, STATUS_NAMES[file.status])
    )
  ]
  if (deleted) return h('li', { class: 'file gone', title }, ...content)
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: 'file',
        title: `Open ${title}`,
        'data-focus': `file:${file.path}`,
        onclick: () => void openFile(workspaceId, file.path)
      },
      ...content
    )
  )
}

/** A group's share of the counted changed lines, e.g. "30%"; "<1%" rather than "0%" for a non-empty share. */
function shareOf(group: CategoryGroup, snap: OkSnapshot): string {
  return formatShare(group.added + group.deleted, snap.added + snap.deleted)
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function fileCount(group: CategoryGroup): string {
  return `${fmt(group.files.length)} ${group.files.length === 1 ? 'file' : 'files'}`
}

function segmentTitle(group: CategoryGroup, snap: OkSnapshot): string {
  const files = fileCount(group)
  return `${group.name} · ${shareOf(group, snap)} of changed lines · ${files} · +${fmt(group.added)} −${fmt(group.deleted)}`
}

function bar(snap: OkSnapshot): HTMLElement {
  const counted = snap.groups.filter((g) => g.id !== 'generated')
  const label = 'Share of changed lines: ' + counted.map((g) => `${g.name} ${shareOf(g, snap)}`).join(', ')
  const total = snap.added + snap.deleted
  return h(
    'div',
    { class: 'bar', role: 'img', 'aria-label': label },
    ...counted.map((g) =>
      h('span', {
        class: `seg c-${g.id}`,
        style: `flex-grow: ${total === 0 ? 1 : g.added + g.deleted}`,
        title: segmentTitle(g, snap)
      })
    )
  )
}

function categoryList(snap: OkSnapshot): HTMLElement {
  return h(
    'div',
    { class: 'groups' },
    ...snap.groups.map((group) => {
      const open = state.open.has(group.id)
      const listId = `files-${group.id}`
      const generated = group.id === 'generated'
      return h(
        'section',
        { class: generated ? 'group generated' : 'group', 'data-cat': group.id },
        h(
          'button',
          {
            type: 'button',
            class: 'group-head',
            'aria-expanded': String(open),
            'aria-controls': listId,
            'data-focus': `group:${group.id}`,
            onclick: () => toggle(group.id)
          },
          h('span', { class: open ? 'chev open' : 'chev' }, svg(ICON_CHEVRON)),
          h('span', { class: `swatch c-${group.id}` }),
          h(
            'span',
            {
              class: 'group-name',
              title: `${group.name}, ${fileCount(group)}${generated ? ', not counted' : ''}`
            },
            group.name
          ),
          h('span', { class: 'muted small file-count' }, fileCount(group)),
          h('span', { class: 'grow' }),
          generated
            ? h('span', { class: 'muted small nowrap not-counted' }, 'not counted')
            : h('span', { class: 'share' }, `${shareOf(group, snap)}`),
          lineCounts(group.added, group.deleted)
        ),
        open
          ? h('ul', { id: listId, class: 'files' }, ...group.files.map((f) => fileRow(f, snap.workspaceId)))
          : null
      )
    })
  )
}

/** Only when the repo has an overrides file: where categories come from, or why it was ignored. */
function footer(snap: OkSnapshot): HTMLElement | null {
  if (!snap.overrides) return null
  const path = snap.overrides
  return h(
    'footer',
    {},
    snap.overridesError
      ? h('span', { class: 'grow error-text' }, `Overrides ignored: ${snap.overridesError}`)
      : // The file name fits a narrow panel; the tooltip has the full path.
        h('span', { class: 'grow ellipsis', title: path }, 'Categories from ', h('code', {}, fileName(path))),
    h(
      'button',
      {
        type: 'button',
        class: 'link',
        'data-focus': 'edit-overrides',
        onclick: () => void openFile(snap.workspaceId, path)
      },
      'Edit'
    )
  )
}

function message(text: string): HTMLElement {
  return h('div', { class: 'message', role: 'status' }, h('p', {}, text))
}

/** A state with nothing to list: an icon, what is going on, and what to do. */
function emptyState(icon: string, title: string, text: string): HTMLElement {
  return h(
    'div',
    { class: 'empty', role: 'status' },
    h('span', { class: 'empty-icon' }, svg(icon, 20)),
    h('h2', {}, title),
    h('p', {}, text)
  )
}

function branchLabel(snap: OkSnapshot): HTMLElement {
  const base = snap.base ? `→ ${snap.base}` : '(no base branch found)'
  return h('span', { class: 'branch', title: `${snap.branch} ${base}` })
}

/** Fills the header's branch label with the longest version that fits its width. */
function fitBranch(): void {
  const label = app.querySelector<HTMLElement>('header .branch')
  const snap = state.snapshot
  if (!label || snap?.state !== 'ok') return
  for (const [text, muted] of branchVersions(snap.branch, snap.base)) {
    label.replaceChildren(
      h('span', { class: 'strong' }, text),
      muted ? h('span', { class: 'muted' }, muted) : ''
    )
    if (label.scrollWidth <= label.clientWidth) return
  }
}

function header(snap: OkSnapshot): HTMLElement {
  return h(
    'header',
    {},
    h(
      'div',
      { class: 'refs' },
      branchLabel(snap),
      h('span', { class: 'grow' }),
      lineCounts(snap.added, snap.deleted)
    )
  )
}

// ---------- Render ----------

const app = h('div', { class: 'app' })
document.body.append(app)
// The header's branch label refits whenever the panel changes width.
new ResizeObserver(() => fitBranch()).observe(app)

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus
  const snap = state.snapshot
  app.replaceChildren(...body(snap))
  fitBranch()
  if (focusKey) app.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus()
}

function body(snap: ChangesSnapshot | null): HTMLElement[] {
  if (!snap) return [message('Loading changes…')]
  switch (snap.state) {
    case 'no-workspace':
      return [
        emptyState(ICON_FOLDER, 'No workspace open', 'Open a Git workspace to see its changes by category.')
      ]
    case 'not-git':
      return [
        emptyState(
          ICON_BRANCH,
          'Not a Git repository',
          'Open a Git workspace to see its changes by category.'
        )
      ]
    case 'remote':
      return [
        emptyState(
          ICON_SERVER,
          'Remote workspaces aren’t supported yet',
          `${snap.workspace} is ${snap.host === 'ssh' ? 'on an SSH host' : 'on a paired Orca server'}. Diff Breakdown can only read repositories on this computer. Use Source Control to see its changes.`
        )
      ]
    case 'unknown-workspace':
      return [
        emptyState(
          ICON_ALERT,
          'Can’t read this workspace',
          `Orca didn’t say where ${snap.workspace} is, so Diff Breakdown can’t show its changes. Use Source Control instead.`
        )
      ]
    case 'error':
      return [emptyState(ICON_ALERT, 'Couldn’t read changes', snap.message)]
    case 'ok':
      break
  }
  const foot = footer(snap)
  if (snap.groups.length === 0) {
    return [
      emptyState(
        ICON_EMPTY_BAR,
        `No changes on ${snap.branch}`,
        'Edits will appear here, broken down by kind, as you work.'
      ),
      ...(foot ? [foot] : [])
    ]
  }
  const counted = snap.groups.some((g) => g.id !== 'generated')
  return [
    header(snap),
    ...(counted ? [h('div', { class: 'controls' }, bar(snap))] : []),
    h('main', {}, categoryList(snap)),
    ...(foot ? [foot] : [])
  ]
}

// ---------- Actions ----------

/** The polling interval from settings, in seconds; 0 means no polling. */
async function readRefreshSeconds(): Promise<number> {
  const seconds = await orca.settings.get('refreshSeconds').catch(() => 10)
  return typeof seconds === 'number' && seconds > 0 ? seconds : 0
}

let pollTimer: ReturnType<typeof setTimeout> | undefined
/** Bumped by each `schedulePolling`, so a tick still refreshing from an older schedule stops there. */
let pollSchedule = 0

/** Refreshes every `seconds` (0 = stop), replacing any earlier schedule; skips ticks while hidden. */
function schedulePolling(seconds: number): void {
  clearTimeout(pollTimer)
  const schedule = ++pollSchedule
  if (seconds <= 0) return
  const next = () => {
    if (schedule === pollSchedule) pollTimer = setTimeout(tick, seconds * 1000)
  }
  const tick = () => {
    if (document.visibilityState === 'hidden') next()
    else void refresher.refresh().finally(next)
  }
  next()
}

/**
 * Reads the focused workspace's changes; a failure becomes an error state filed under `key`, the
 * workspace it was asked for, never a throw.
 */
async function fetchSnapshot(key: string | null): Promise<ChangesAnswer> {
  try {
    return await orca.plugin.request('changes.get', undefined, { timeoutMs: 60_000 })
  } catch (error) {
    const err = error as { code?: string; message?: string }
    return { focus: key, snapshot: { state: 'error', message: err.message ?? err.code ?? 'unknown error' } }
  }
}

/**
 * One fetch at a time, switches never dropped, answers shown only for the workspace they were
 * read from, and each workspace's last result shown at once when you come back to it.
 */
const refresher = createRefresher<ChangesAnswer>({
  fetch: fetchSnapshot,
  keyOf: (answer) => answer.focus,
  show: (answer) => {
    const next = answer?.snapshot ?? null
    if (JSON.stringify(next) === JSON.stringify(state.snapshot)) return
    state.snapshot = next
    render()
  }
})

async function openFile(workspaceId: string, path: string): Promise<void> {
  try {
    await orca.plugin.request('changes.open', { workspaceId, path })
  } catch {
    // Orca shows nothing for a file it cannot open; the row stays as it is.
  }
}

function toggle(id: CategoryId): void {
  if (state.open.has(id)) state.open.delete(id)
  else state.open.add(id)
  void orca.storage.set('open', [...state.open])
  render()
}

// ---------- Styles ----------

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--orca-background); color: var(--orca-foreground);
  font: 13px/1.4 var(--orca-font-sans, system-ui, sans-serif); }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: -2px; border-radius: 4px; }
code { font: 12px var(--orca-font-mono, ui-monospace, monospace); color: var(--orca-foreground); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* The panel is the container: narrow-width rules below key off its width. */
.app { display: flex; flex-direction: column; min-height: 100vh; container-type: inline-size; }
.muted { color: var(--orca-muted-foreground); }
.small { font-size: 12px; }
.strong { font-weight: 600; }
.grow { flex: 1; }
.nowrap { white-space: nowrap; flex: none; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

header .refs { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 12px;
  font: 12px var(--orca-font-mono, ui-monospace, monospace); border-bottom: 1px solid var(--orca-border); }
.branch { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.counts { display: inline-flex; gap: 6px; font: 12px var(--orca-font-mono, ui-monospace, monospace); white-space: nowrap; flex: none; }
.counts.small { font-size: 11px; }
.add { color: var(--cc-add); }
.del { color: var(--cc-del); }

.controls { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border-bottom: 1px solid var(--orca-border); }
.bar { display: flex; gap: 2px; height: 12px; border-radius: 6px; overflow: hidden; background: var(--orca-muted); }
.seg { min-width: 4px; flex-basis: 0; cursor: default; transition: opacity 120ms; }
/* Hovering a segment or a category row highlights its partner and dims the other segments. */
.app:has(.seg:hover) .seg, .app:has(.group-head:hover) .seg { opacity: 0.35; }
.app:has(.seg:hover) .seg:hover { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .seg { transition: none; } }

main { flex: 1; }
.group { border-bottom: 1px solid var(--orca-border); }
.group-head { width: 100%; min-height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.group-head:hover, .file:hover { background: var(--orca-accent); }
/* Names give way last (after .grow and the folder text), with an ellipsis; numbers never shrink. */
.group-name { font-weight: 600; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.file-count { white-space: nowrap; flex: none; }
.generated .group-name { font-weight: 500; color: var(--orca-muted-foreground); }
.chev { display: inline-flex; flex: none; color: var(--orca-muted-foreground); transition: transform 120ms; }
.chev.open { transform: rotate(90deg); }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.share { flex: none; white-space: nowrap; font-size: 12px; color: var(--orca-muted-foreground); min-width: 32px; text-align: right; }

.files { list-style: none; margin: 0; padding: 0 0 6px; }
.file { width: 100%; min-height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 34px; color: var(--orca-muted-foreground); }
.file svg { flex: none; }
.file .name { color: var(--orca-foreground); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.file .dir { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file.gone .name { text-decoration: line-through; color: var(--orca-muted-foreground); }
.status { width: 14px; text-align: center; font-weight: 600; font-size: 12px; flex: none; }
/* Narrow panels: the file count goes first (still read aloud and in the tooltip), then folders and the %. */
@container (max-width: 359px) {
  .file-count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
}
@container (max-width: 259px) {
  .file .dir, .share, .not-counted { display: none; }
  .group-head, .file { gap: 6px; }
}
.s-A, .s-U { color: var(--cc-add); }
.s-D { color: var(--cc-del); }
.s-M, .s-R, .s-C, .s-T { color: var(--cc-mod); }

footer { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--orca-border);
  font-size: 12px; color: var(--orca-muted-foreground); }
.error-text { color: var(--orca-destructive); }
.link { color: var(--orca-primary); min-height: 28px; padding: 0 4px; white-space: nowrap; text-decoration: underline; text-underline-offset: 2px; }
.message { padding: 24px 16px; color: var(--orca-muted-foreground); }
.message p { margin: 0; }
.empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px;
  padding: 72px 24px; color: var(--orca-muted-foreground); }
.empty-icon { display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 6px;
  border-radius: 10px; background: var(--orca-muted); }
.empty h2 { margin: 0; font-size: 13px; font-weight: 600; color: var(--orca-foreground); }
.empty p { margin: 0; max-width: 240px; font-size: 12px; line-height: 1.5; }

/* Category colours: told apart by lightness as well as hue; the names carry the meaning. */
:root, html.dark {
  --cc-add: #5fcf85; --cc-del: #f07872; --cc-mod: #d9b25a;
  --c-runtime: #5b8def; --c-tests: #f0a35e; --c-contracts: #b39af7; --c-migrations: #f2d675;
  --c-cicd: #3fa7c9; --c-config: #ef7fae; --c-dependencies: #9aa5b1; --c-docs: #7fc8c0; --c-generated: #6b6f76;
}
html.light {
  --cc-add: #1a7f37; --cc-del: #c4312b; --cc-mod: #8a6300;
  --c-runtime: #2f6fe0; --c-tests: #d47616; --c-contracts: #7c55e0; --c-migrations: #b88a00;
  --c-cicd: #137f9f; --c-config: #c93a75; --c-dependencies: #66717d; --c-docs: #2a8f84; --c-generated: #a3a8ae;
}
`

/** Per category: its colour class, and the hover pairing between its bar segment and its row. */
const LINK_STYLE = CATEGORIES.map(
  ({ id }) =>
    `.c-${id} { background: var(--c-${id}); }\n` +
    `.app:has(.seg.c-${id}:hover) .group[data-cat="${id}"] .group-head { background: var(--orca-accent); }\n` +
    `.app:has(.group[data-cat="${id}"] .group-head:hover) .seg.c-${id} { opacity: 1; }`
).join('\n')

document.head.append(h('style', {}, STYLE + LINK_STYLE))

// ---------- Start ----------

void (async () => {
  const open = await orca.storage.get('open').catch(() => null)
  if (Array.isArray(open)) state.open = new Set(open.filter((x): x is CategoryId => typeof x === 'string'))
  render()

  // Fires once on subscribing (the first fetch, even with nothing focused), then on every focus
  // change; the refresher ignores repeats.
  orca.on('workspace.changed', ({ context }) => refresher.setFocus(context?.workspaceId ?? null))
  // Coming back to the panel shows current changes without waiting for the timer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresher.refresh()
  })

  // Settings apply while the panel is open: a new interval reschedules polling, and any change
  // (e.g. the base branch) refreshes now.
  orca.settings.onDidChange(({ key }) => {
    if (key === 'refreshSeconds') void readRefreshSeconds().then(schedulePolling)
    void refresher.refresh()
  })
  schedulePolling(await readRefreshSeconds())
})()
