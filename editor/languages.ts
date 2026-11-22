// The syntax grammars the diff editor ships. Shiki has 242; bundling them all made the plugin 11 MiB.
// These cover every ecosystem the panel detects (src/git.ts MARKER_PATHSPECS) plus the config, docs
// and web formats most repositories carry. Any other language still diffs, as uncoloured text.
// scripts/build-editor.ts leaves every grammar not listed here out of editor/dist.
// No imports: Orca's test runner loads editor code unbundled, where packages can't be imported, so
// diff.ts passes Shiki's catalogue in.

export const SHIPPED_LANGUAGES = [
  // Ecosystems the panel recognises
  'rust',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'go',
  'java',
  'kotlin',
  'groovy',
  'csharp',
  'fsharp',
  'swift',
  'objective-c',
  'objective-cpp',
  'ruby',
  'php',
  'elixir',
  // Web
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  'astro',
  'graphql',
  // Config and data
  'json',
  'jsonc',
  'yaml',
  'toml',
  'xml',
  'ini',
  'dotenv',
  'docker',
  'make',
  'hcl',
  'terraform',
  'nix',
  'proto',
  // Docs and scripts
  'markdown',
  'mdx',
  'sql',
  'shellscript',
  'powershell',
  // Systems
  'c',
  'cpp',
  'lua',
  'zig',
  'dart'
] as const

const shipped = new Set<string>(SHIPPED_LANGUAGES)

/** A row of Shiki's `bundledLanguagesInfo`, as far as this reads it. */
type LanguageInfo = { id: string; aliases?: readonly string[] }

/**
 * Picks the language to highlight a file as: itself when its grammar ships, else plain text. Pierre
 * throws on a grammar it can't load, which would show no diff at all instead of an uncoloured one.
 * A shipped grammar answers to its id and to Shiki's aliases, which Pierre detects from file names
 * (`a.yml` → `yml`, `a.sh` → `zsh`, `a.tf` → `tf`).
 */
export function shippedLanguages(catalogue: readonly LanguageInfo[]): (lang: string) => string {
  const names = new Set(
    catalogue.filter((info) => shipped.has(info.id)).flatMap((info) => [info.id, ...(info.aliases ?? [])])
  )
  return (lang) => (names.has(lang) ? lang : 'text')
}
