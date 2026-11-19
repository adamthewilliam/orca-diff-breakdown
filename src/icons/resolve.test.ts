import { assert, test } from 'orca/testing'
import { ICON_SVGS } from './svgs'
import { fileIcon } from './resolve'

test('picks the Catppuccin icon for a file name', () => {
  const cases: [string, string][] = [
    ['process_tracker.rs', 'rust'],
    ['DiskPopup.tsx', 'typescript-react'],
    ['MetricPopup.test.tsx', 'typescript-test'],
    ['routeTree.gen.ts', 'typescript'],
    ['index.d.ts', 'typescript-def'],
    ['package.json', 'package-json'],
    ['bun.lock', 'bun-lock'],
    ['Cargo.toml', 'cargo'],
    ['Cargo.lock', 'cargo-lock'],
    ['Dockerfile', 'docker'],
    ['.env.local', 'env'],
    ['README.md', 'readme'],
    ['CHANGELOG.md', 'changelog'],
    ['notes.md', 'markdown'],
    ['FOO.TS', 'typescript'],
    ['Makefile', 'makefile'],
    ['.gitignore', 'git'],
    ['.env', 'env']
  ]
  for (const [name, icon] of cases) assert.equal(fileIcon(name), icon, name)
})

test('vite and vitest config variants get their tool’s icon', () => {
  assert.equal(fileIcon('vite.config.ts'), 'vite')
  assert.equal(fileIcon('vite.config.screenshot.ts'), 'vite')
  assert.equal(fileIcon('vitest.config.e2e.mts'), 'vitest')
  assert.equal(fileIcon('vite.svg'), 'svg', 'only config files')
})

test('unknown names fall back to the plain file icon', () => {
  assert.equal(fileIcon('somebinary'), '_file')
  assert.equal(fileIcon('.weirdrc-nothing'), '_file')
  assert.equal(fileIcon('archive.unknownext'), '_file')
  assert.equal(fileIcon(''), '_file')
  assert.equal(fileIcon('constructor'), '_file', 'not an Object.prototype key')
  assert.equal(fileIcon('x.__proto__'), '_file')
})

test('every icon the resolver can return is bundled', () => {
  for (const name of ['a.rs', 'b.tsx', 'Dockerfile', 'x', 'vite.config.x.ts']) {
    assert.ok(fileIcon(name) in ICON_SVGS, name)
  }
})
