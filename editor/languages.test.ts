import { readdirSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { shippedLanguages } from './languages'

/** Rows shaped like Shiki's `bundledLanguagesInfo` (shiki 4.6), shipped and not. */
const shippedLanguage = shippedLanguages([
  { id: 'rust', aliases: ['rs'] },
  { id: 'typescript', aliases: ['ts', 'cts', 'mts'] },
  { id: 'yaml', aliases: ['yml'] },
  { id: 'shellscript', aliases: ['bash', 'sh', 'shell', 'zsh'] },
  { id: 'docker', aliases: ['dockerfile'] },
  { id: 'terraform', aliases: ['tf', 'tfvars'] },
  { id: 'emacs-lisp', aliases: ['elisp'] },
  { id: 'wolfram', aliases: ['wl'] }
])

test('a shipped grammar keeps its name, by id or by the alias Pierre detects from a file name', () => {
  assert.equal(shippedLanguage('rust'), 'rust')
  assert.equal(shippedLanguage('typescript'), 'typescript')
  // getFiletypeFromFileName answers aliases: a.yml → yml, a.sh → zsh, Dockerfile → dockerfile, a.tf → tf.
  for (const alias of ['yml', 'zsh', 'dockerfile', 'tf']) assert.equal(shippedLanguage(alias), alias)
})

test('a grammar left out of the bundle reads as plain text instead of failing the diff', () => {
  assert.equal(shippedLanguage('emacs-lisp'), 'text')
  assert.equal(shippedLanguage('elisp'), 'text')
  assert.equal(shippedLanguage('wolfram'), 'text')
  assert.equal(shippedLanguage('text'), 'text')
})

test('the committed bundle holds the shipped grammars and themes, and leaves out the rest', () => {
  const dist = new URL('./dist/', import.meta.url)
  const text = readdirSync(dist)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(new URL(name, dist), 'utf8'))
    .join('\n')
  // Grammar files carry their TextMate scope name; theme files their display name.
  assert.ok(text.includes('source.rust'), 'the Rust grammar is bundled')
  assert.ok(text.includes('source.ts'), 'the TypeScript grammar is bundled')
  assert.ok(!text.includes('source.emacs.lisp'), 'the Emacs Lisp grammar is left out')
  assert.ok(!text.includes('source.wolfram'), 'the Wolfram grammar is left out')
  assert.ok(text.includes('Pierre Dark') && text.includes('Pierre Light'), 'both Pierre themes are bundled')
  assert.ok(!text.includes('Catppuccin Mocha'), 'other themes are left out')
})
