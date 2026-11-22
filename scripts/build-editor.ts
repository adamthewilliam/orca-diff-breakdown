// Bundles the diff editor (editor/diff.ts) into editor/dist, which Orca loads as plain files.
//
// Shiki and Pierre load each grammar and theme by package path (`@shikijs/langs/rust`,
// `@shikijs/themes/nord`, `@pierre/theme/pierre-dark`) from catalogues of every one they know, so a
// plain bundle ships all of them: 242 grammars and some 150 theme files, 10.6 MiB. This build points
// every path the editor never loads at one empty module, keeping the grammars in
// editor/languages.ts and the two Pierre themes. Grammars a kept one embeds (CSS in Vue) are
// imported by relative path and stay.
import type { BunPlugin } from 'bun'
import { rmSync } from 'node:fs'
import { SHIPPED_LANGUAGES } from '../editor/languages'

const KEPT_LANGUAGES = new Set<string>(SHIPPED_LANGUAGES)
const KEPT_THEMES = new Set(['pierre-dark', 'pierre-light'])

const EMPTY = { path: 'empty', namespace: 'left-out' }

const trim: BunPlugin = {
  name: 'leave out unused grammars and themes',
  setup(build) {
    const last = (path: string) => path.slice(path.lastIndexOf('/') + 1)
    build.onResolve({ filter: /^@shikijs\/langs\/[^/]+$/ }, (args) =>
      KEPT_LANGUAGES.has(last(args.path)) ? undefined : EMPTY
    )
    build.onResolve({ filter: /^@pierre\/theme\/[^/]+$/ }, (args) =>
      KEPT_THEMES.has(last(args.path)) ? undefined : EMPTY
    )
    // Only Pierre's own themes are used, and only the Shiki highlighter.
    build.onResolve({ filter: /^@shikijs\/themes\/[^/]+$/ }, () => EMPTY)
    build.onResolve({ filter: /^@pierre\/highlights\/themes\/[^/]+$/ }, () => EMPTY)
    // The highlighter is Pierre's default, Shiki's JavaScript engine (`preferredHighlighter: 'shiki-js'`):
    // the WebAssembly engines behind 'shiki-wasm' (Oniguruma) and 'highlights' are never loaded.
    build.onResolve({ filter: /^(shiki\/wasm|shiki\/engine\/oniguruma)$/ }, () => EMPTY)
    build.onResolve({ filter: /^\.\/backends\/highlights(\.js)?$/ }, (args) =>
      args.importer.includes('@pierre/diffs') ? EMPTY : undefined
    )
    // Never evaluated: editor/diff.ts only asks for shipped grammars (shippedLanguage) and Pierre themes.
    build.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({
      contents: 'export default []',
      loader: 'js'
    }))
  }
}

rmSync(new URL('../editor/dist', import.meta.url), { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [new URL('../editor/diff.ts', import.meta.url).pathname],
  outdir: new URL('../editor/dist', import.meta.url).pathname,
  format: 'esm',
  target: 'browser',
  splitting: true,
  minify: true,
  plugins: [trim]
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
const bytes = result.outputs.reduce((sum, output) => sum + output.size, 0)
console.log(`editor/dist: ${result.outputs.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`)
