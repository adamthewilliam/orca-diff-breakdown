import { assert, test } from 'orca/testing'
import { parseNameStatusZ, parseNumstatZ } from './git'

test('numstat -z: plain, binary and renamed rows', () => {
  const out = ['12\t3\tsrc/a.rs', '-\t-\tassets/logo.png', '4\t1\t', 'old/b.rs', 'new/b.rs', ''].join('\0')
  assert.deepEqual(parseNumstatZ(out), [
    { path: 'src/a.rs', added: 12, deleted: 3 },
    { path: 'assets/logo.png', added: null, deleted: null },
    { path: 'new/b.rs', added: 4, deleted: 1 }
  ])
})

test('name-status -z: statuses, renames and paths with spaces', () => {
  const out = [
    'M',
    'src/a.rs',
    'A',
    'docs/new guide.md',
    'R087',
    'old/b.rs',
    'new/b.rs',
    'D',
    'gone.rs',
    ''
  ].join('\0')
  assert.deepEqual(parseNameStatusZ(out), [
    { path: 'src/a.rs', status: 'M' },
    { path: 'docs/new guide.md', status: 'A' },
    { path: 'new/b.rs', oldPath: 'old/b.rs', status: 'R' },
    { path: 'gone.rs', status: 'D' }
  ])
})
