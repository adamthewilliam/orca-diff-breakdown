// The diff editor. The worker writes each changed file's patch to a `.breakdown.diff` file in the
// workspace and opens it; Orca opens those here, and this frame draws them with @pierre/diffs. It only
// reads: when the worker rewrites a patch on disk, Orca hands over the new text and the diff redraws.
// Bundled by `bun run build` (scripts/build-editor.ts) into editor/dist, since Orca frames can't
// import npm packages.
import { FileDiff, getFiletypeFromFileName, parsePatchFiles } from '@pierre/diffs'
import { GIT_COLORS } from '../src/colors'
import { bundledLanguagesInfo } from 'shiki/langs'
import { shippedLanguages } from './languages'

type Typography = Awaited<ReturnType<typeof orca.host.call<'editor.readTypography'>>>

const shippedLanguage = shippedLanguages(bundledLanguagesInfo)

const root = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'))
let views: FileDiff[] = []
let wrap = false

const mode = (): 'light' | 'dark' => (document.documentElement.classList.contains('light') ? 'light' : 'dark')

/**
 * The panel's git colours, so `+51 −8` in the panel and the diff's lines are the same green and red.
 * Orca's own git colours win if it ever passes them to frames.
 */
function applyGitColors(): void {
  const git = GIT_COLORS[mode()]
  const style = document.documentElement.style
  style.setProperty('--diffs-addition-color-override', `var(--orca-git-decoration-added, ${git.added})`)
  style.setProperty('--diffs-modified-color-override', `var(--orca-git-decoration-modified, ${git.modified})`)
  style.setProperty('--diffs-deletion-color-override', `var(--orca-git-decoration-deleted, ${git.deleted})`)
}

function render(text: string): void {
  for (const view of views) view.cleanUp()
  views = []
  const files = parsePatchFiles(text).flatMap((patch) => patch.files)
  if (files.length === 0) {
    // The worker's own notes, such as "No changes against origin/main now."
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = text.trim() || 'No changes.'
    root.replaceChildren(note)
    return
  }
  root.replaceChildren()
  for (const fileDiff of files) {
    // Only some grammars ship (editor/languages.ts); any other language diffs as plain text.
    fileDiff.lang = shippedLanguage(
      fileDiff.lang ?? getFiletypeFromFileName(fileDiff.name)
    ) as typeof fileDiff.lang
    const container = document.createElement('div')
    root.append(container)
    const view = new FileDiff({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: mode(),
      diffStyle: 'unified',
      overflow: wrap ? 'wrap' : 'scroll',
      stickyHeader: true,
      // `+`/`-` marks, so added and removed lines never differ by colour alone (WCAG 1.4.1).
      diffIndicators: 'classic',
      // Full-width and compact: the default rounded pill looks like a button but can't expand a patch.
      hunkSeparators: 'line-info-basic',
      // Rows, gutter and header paint light-dark(--diffs-light-bg, --diffs-dark-bg), which the theme
      // sets inside the shadow root; only the `unsafe` layer outranks it.
      unsafeCSS: ':host { --diffs-dark-bg: var(--orca-card); --diffs-light-bg: var(--orca-card); }'
    })
    view.render({ fileDiff, containerWrapper: container })
    views.push(view)
    // Some changes have no lines to show; say what changed instead of an empty diff.
    const notes = [
      fileDiff.prevMode && fileDiff.mode && fileDiff.prevMode !== fileDiff.mode
        ? `Mode changed: ${fileDiff.prevMode} → ${fileDiff.mode}${executableNote(fileDiff.prevMode, fileDiff.mode)}`
        : null,
      fileDiff.type === 'rename-pure' ? 'Renamed. The contents are unchanged.' : null
    ].filter((note): note is string => note !== null)
    for (const text of notes) {
      const note = document.createElement('p')
      note.className = 'file-note'
      note.textContent = text
      root.append(note)
    }
  }
}

/** Git's `100755` is an executable file, `100644` a plain one. */
function executableNote(from: string, to: string): string {
  if (from === '100644' && to === '100755') return ' (now executable)'
  if (from === '100755' && to === '100644') return ' (no longer executable)'
  return ''
}

/** Orca's editor font, size, line height and ligatures, so the diff reads like Orca's own diff view. */
function applyTypography(t: Typography): void {
  const style = document.documentElement.style
  style.setProperty('--diffs-font-family', t.cssFontFamily)
  style.setProperty('--diffs-font-size', `${t.fontSize}px`)
  // Orca's line height follows VS Code: 0 is automatic (1.5 × the font size on macOS, 21px at 14px),
  // under 8 multiplies the font size, else pixels. CSS `normal` (about 1.2) set lines tighter than Orca's.
  const lineHeight =
    t.lineHeight <= 0 ? 1.5 * t.fontSize : t.lineHeight < 8 ? t.lineHeight * t.fontSize : t.lineHeight
  style.setProperty('--diffs-line-height', `${Math.round(lineHeight)}px`)
  style.setProperty('--diffs-font-features', t.fontLigatures ? 'normal' : '"liga" 0, "calt" 0')
  wrap = t.wordWrap === 'on'
}

async function start(): Promise<void> {
  const document_ = orca.document
  if (!document_) return
  if (orca.host.has('editor.readTypography')) {
    applyTypography((await orca.host.call('editor.readTypography', {}).catch(() => null)) ?? FALLBACK)
    orca.on('editor.typography.changed', (t) => {
      applyTypography(t)
      void document_.get().then((d) => d.content.kind === 'text' && render(d.content.text))
    })
  }
  applyGitColors()
  const session = await document_.session()
  render(session.value)
  session.onReplace(render)
  // Orca has already flipped the html class when this fires.
  orca.on('theme', () => {
    applyGitColors()
    for (const view of views) view.setThemeType(mode())
  })
}

const FALLBACK: Typography = {
  fontFamily: 'monospace',
  cssFontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  fontWeight: 'normal',
  lineHeight: 0,
  fontLigatures: false,
  wordWrap: 'off',
  minimap: false
}

void start().catch((error: unknown) => {
  console.error('[diff-breakdown] the diff editor failed to start', error)
  root.textContent = 'This diff could not be shown. Use Source to read the patch.'
})
