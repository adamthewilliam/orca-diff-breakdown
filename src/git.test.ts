import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles, git, parseNameStatusZ, parseNumstatZ } from './git'

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

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diff-breakdown-git-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  return dir
}

test('a changed binary file has no line counts, not zero', async () => {
  const dir = tempRepo()
  try {
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'logo'], { cwd: dir })
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]))
    assert.deepEqual(await changedFiles(dir, null), [
      { path: 'logo.png', status: 'M', added: null, deleted: null }
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a failing git command reports git's reason, not the command line", async () => {
  const dir = tempRepo()
  try {
    const error = await git(dir, ['diff', 'no-such-ref', '--']).then(
      () => null,
      (e: Error) => e
    )
    assert.ok(error, 'it rejects')
    assert.ok(!error!.message.startsWith('Command failed'), error!.message)
    assert.match(error!.message, /no-such-ref/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reading changes never rewrites .git/index, and touched-but-unchanged files are not listed', async () => {
  const dir = tempRepo()
  try {
    for (const name of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(dir, name), `${name}\n`)
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), 'a.txt\nchanged\n')
    // Make every file look stat-dirty, as editors and agents do, so git would refresh the index.
    const later = new Date(Date.now() + 5_000)
    for (const name of ['a.txt', 'b.txt', 'c.txt']) utimesSync(join(dir, name), later, later)
    const before = statSync(join(dir, '.git/index')).mtimeMs
    const files = await changedFiles(dir, null)
    assert.equal(statSync(join(dir, '.git/index')).mtimeMs, before, '.git/index was rewritten')
    assert.deepEqual(files, [{ path: 'a.txt', status: 'M', added: 1, deleted: 0 }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
