import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles, filePatch, git, parseNameStatusZ, parseNumstatZ } from './git'

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

// filePatch: one file's unified diff, against the same target and with the same flags as the counts.

/** A repo on `feature`, one commit ahead of `main`, with `files` committed on `main`. */
function branchedRepo(files: Record<string, string>): { dir: string; run: (...args: string[]) => string } {
  const dir = tempRepo()
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  run('add', '.')
  run('commit', '-q', '-m', 'base')
  run('checkout', '-q', '-b', 'feature')
  return { dir, run }
}

async function patchOf(dir: string, base: string | null, path: string): Promise<string | null> {
  const file = (await changedFiles(dir, base)).find((f) => f.path === path)
  assert.ok(file, `${path} is listed as changed`)
  return filePatch(dir, base, file!)
}

const hunkLines = (patch: string, sign: '+' | '-') =>
  patch.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).length

test('filePatch: a modified file, committed and uncommitted, against the merge-base', async () => {
  const { dir, run } = branchedRepo({ 'a.rs': 'one\n' })
  try {
    writeFileSync(join(dir, 'a.rs'), 'one\ntwo\n')
    run('commit', '-q', '-am', 'two')
    writeFileSync(join(dir, 'a.rs'), 'one\ntwo\nthree\n')
    const patch = (await patchOf(dir, 'main', 'a.rs'))!
    assert.match(patch, /^--- a\/a\.rs$/m)
    assert.match(patch, /^\+\+\+ b\/a\.rs$/m)
    assert.match(patch, /^\+two$/m)
    assert.match(patch, /^\+three$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: its +/- lines match the counts the panel shows', async () => {
  const { dir } = branchedRepo({ 'a.rs': 'a\nb\nc\nd\n' })
  try {
    writeFileSync(join(dir, 'a.rs'), 'a\nB\nc\nd\ne\nf\n')
    const [file] = await changedFiles(dir, 'main')
    const patch = (await filePatch(dir, 'main', file))!
    assert.equal(hunkLines(patch, '+'), file.added)
    assert.equal(hunkLines(patch, '-'), file.deleted)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: an untracked file is all additions, though git diff --no-index exits 1', async () => {
  const { dir } = branchedRepo({ 'a.rs': 'one\n' })
  try {
    writeFileSync(join(dir, 'new file.rs'), 'x\ny\n')
    const patch = (await patchOf(dir, 'main', 'new file.rs'))!
    assert.match(patch, /^--- \/dev\/null$/m)
    // git ends a header whose path has a space with a tab; parsers (Pierre's included) expect it.
    assert.match(patch, /^\+\+\+ b\/new file\.rs\t?$/m)
    assert.equal(hunkLines(patch, '+'), 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: a renamed file diffs old path against new, not as a delete and an add', async () => {
  const { dir, run } = branchedRepo({ 'old.rs': 'a\nb\nc\nd\ne\n' })
  try {
    run('mv', 'old.rs', 'new.rs')
    writeFileSync(join(dir, 'new.rs'), 'a\nb\nc\nd\ne\nf\n')
    const patch = (await patchOf(dir, 'main', 'new.rs'))!
    assert.match(patch, /^rename from old\.rs$/m)
    assert.match(patch, /^rename to new\.rs$/m)
    assert.match(patch, /^\+f$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: a pure rename has a header and no hunks', async () => {
  const { dir } = branchedRepo({ 'old.rs': 'a\nb\n' })
  try {
    renameSync(join(dir, 'old.rs'), join(dir, 'new.rs'))
    execFileSync('git', ['add', '-A'], { cwd: dir })
    const patch = (await patchOf(dir, 'main', 'new.rs'))!
    assert.match(patch, /^rename from old\.rs$/m)
    assert.ok(!/^@@/m.test(patch), 'no hunks')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: a mode-only change has mode lines and no hunks', async () => {
  const { dir } = branchedRepo({ 'run.sh': 'echo hi\n' })
  try {
    chmodSync(join(dir, 'run.sh'), 0o755)
    const patch = (await patchOf(dir, 'main', 'run.sh'))!
    assert.match(patch, /^old mode 100644$/m)
    assert.match(patch, /^new mode 100755$/m)
    assert.ok(!/^@@/m.test(patch), 'no hunks')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: a deleted file is all removals', async () => {
  const { dir } = branchedRepo({ 'gone.rs': 'a\nb\n' })
  try {
    rmSync(join(dir, 'gone.rs'))
    const patch = (await patchOf(dir, 'main', 'gone.rs'))!
    assert.match(patch, /^deleted file mode/m)
    assert.equal(hunkLines(patch, '-'), 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: a binary file has no patch, so the panel opens the file instead', async () => {
  const { dir } = branchedRepo({ 'logo.png': '\x89PNG\0\x01' })
  try {
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9]))
    assert.equal(await patchOf(dir, 'main', 'logo.png'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch: works in a repository with no commits yet', async () => {
  const dir = tempRepo()
  try {
    writeFileSync(join(dir, 'first.rs'), 'hello\n')
    const patch = (await patchOf(dir, null, 'first.rs'))!
    assert.match(patch, /^\+hello$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filePatch never rewrites .git/index', async () => {
  const { dir } = branchedRepo({ 'a.rs': 'a\n' })
  try {
    writeFileSync(join(dir, 'a.rs'), 'a\nb\n')
    writeFileSync(join(dir, 'u.rs'), 'u\n')
    const later = new Date(Date.now() + 5_000)
    utimesSync(join(dir, 'a.rs'), later, later)
    const before = statSync(join(dir, '.git/index')).mtimeMs
    await patchOf(dir, 'main', 'a.rs')
    await patchOf(dir, 'main', 'u.rs')
    assert.equal(statSync(join(dir, '.git/index')).mtimeMs, before, '.git/index was rewritten')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
