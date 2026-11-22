import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { CATEGORY_COLORS, GIT_COLORS } from './colors'

/**
 * Orca's default `--card` per mode (client CSS in Orca 1.4.x: `.dark { --card: #171717 }`,
 * `:root { --card: #fff }`). The panel sits on the sidebar colour, which is `--card` by default.
 */
const DEFAULT_CARD = { dark: '#171717', light: '#ffffff' } as const

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('contrast is measured as WCAG defines it', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0')
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48')
})

test('every category colour stands out 3:1 from the panel background, dark and light', () => {
  for (const mode of ['dark', 'light'] as const) {
    for (const [id, color] of Object.entries(CATEGORY_COLORS[mode])) {
      const ratio = contrast(color, DEFAULT_CARD[mode])
      assert.ok(ratio >= 3, `${mode} ${id} ${color} is ${ratio.toFixed(2)}:1 on ${DEFAULT_CARD[mode]}`)
    }
  }
})

test('git colours fall back to Orca’s built-in decoration colours', () => {
  assert.deepEqual(GIT_COLORS.dark, {
    added: '#81b88b',
    modified: '#e2c08d',
    untracked: '#73c991',
    deleted: '#c74e39'
  })
  assert.deepEqual(GIT_COLORS.light, {
    added: '#587c0c',
    modified: '#895503',
    untracked: '#007100',
    deleted: '#ad0707'
  })
})

test('every git colour stands out 3:1 from the panel background, dark and light', () => {
  for (const mode of ['dark', 'light'] as const) {
    for (const [kind, color] of Object.entries(GIT_COLORS[mode])) {
      const ratio = contrast(color, DEFAULT_CARD[mode])
      assert.ok(ratio >= 3, `${mode} ${kind} ${color} is ${ratio.toFixed(2)}:1 on ${DEFAULT_CARD[mode]}`)
    }
  }
})

test('the panel has no colour literals: colours come from Orca’s theme or src/colors.ts', () => {
  const source = readFileSync(new URL('../panel/main.ts', import.meta.url), 'utf8')
  const literals = source.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/gi) ?? []
  assert.deepEqual(literals, [])
})
