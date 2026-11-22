// Runs the worker against a real temporary git repository, with Orca's host mocked.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import { MAX_PATCHES } from './patches'
import { groupFiles, pickWorkspace, toWorkspacePath } from './worker'

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'diff-breakdown-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  write('Cargo.toml', '[package]\nname = "app"\n')
  write('src/lib.rs', 'pub fn one() {}\n')
  write('README.md', '# App\n')
  write('.gitattributes', 'src/generated/** linguist-generated\n')
  run('add', '.')
  run('commit', '-q', '-m', 'base')
  run('checkout', '-q', '-b', 'feature')
  // Committed on the branch.
  write('src/lib.rs', 'pub fn one() {}\npub fn two() {}\n')
  write('tests/lib_tests.rs', 'use app::two;\n#[test]\nfn t() { two(); }\n')
  run('add', '.')
  run('commit', '-q', '-m', 'feature work')
  // Uncommitted and untracked.
  write('README.md', '# App\n\nNow with two.\n')
  write('migrations/0001_init.sql', 'create table a (id int);\ncreate table b (id int);\n')
  write('.github/workflows/ci.yml', 'on: push\n')
  write('src/generated/api.rs', 'pub struct Api;\n')
  write('.orca/diff-breakdown.json', '{"rules": [{"category": "contracts", "paths": ["src/lib.rs"]}]}')
  return dir
}

const workspace = (path: string) => ({
  id: 'ws-1',
  kind: 'worktree',
  name: 'feature',
  path,
  branch: 'feature',
  hostId: 'local'
})

test('groups the focused workspace’s changes against its base branch', async () => {
  const repo = makeRepo()
  try {
    const host = mockHost({
      results: {
        'workspace.readContext': {
          workspaceId: 'ws-1',
          branch: 'feature',
          displayName: 'feature',
          terminals: []
        },
        'workspace.list': { workspaces: [workspace(repo)], truncated: false }
      }
    })
    const worker = await mountWorker(main, { host })
    const snap = (await worker.request('changes.get')).snapshot
    assert.equal(snap.state, 'ok')
    if (snap.state !== 'ok') return
    assert.equal(snap.base, 'main')
    assert.equal(snap.branch, 'feature')
    assert.deepEqual(snap.ecosystems, ['Rust'])
    assert.equal(snap.overrides, '.orca/diff-breakdown.json')

    const byId = Object.fromEntries(snap.groups.map((g) => [g.id, g.files.map((f) => f.path)]))
    assert.deepEqual(byId, {
      tests: ['tests/lib_tests.rs'],
      contracts: ['src/lib.rs'],
      migrations: ['migrations/0001_init.sql'],
      cicd: ['.github/workflows/ci.yml'],
      config: ['.orca/diff-breakdown.json'],
      docs: ['README.md'],
      generated: ['src/generated/api.rs']
    })
    const migrations = snap.groups.find((g) => g.id === 'migrations')
    assert.deepEqual(migrations?.files[0], {
      path: 'migrations/0001_init.sql',
      status: 'U',
      added: 2,
      deleted: 0
    })
    // Generated files are listed but left out of the totals: 1 + 3 + 2 + 1 + 1 + 2 lines added.
    assert.equal(snap.added, 10)
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('reports a folder that is not a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diff-breakdown-plain-'))
  try {
    const host = mockHost({
      results: {
        'workspace.readContext': { workspaceId: 'ws-1', branch: '', displayName: 'notes', terminals: [] },
        'workspace.list': {
          workspaces: [{ ...workspace(dir), name: 'notes', branch: null }],
          truncated: false
        }
      }
    })
    const worker = await mountWorker(main, { host })
    const snap = (await worker.request('changes.get')).snapshot
    assert.deepEqual(snap, { state: 'not-git', workspace: 'notes', path: dir })
    await worker.deactivate()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no focused workspace, and remote workspaces', async () => {
  const none = await mountWorker(main, {
    host: mockHost({
      results: { 'workspace.readContext': null, 'workspace.list': { workspaces: [], truncated: false } }
    })
  })
  assert.deepEqual(await none.request('changes.get'), { focus: null, snapshot: { state: 'no-workspace' } })
  await none.deactivate()

  const remote = await mountWorker(main, {
    host: mockHost({
      results: {
        'workspace.readContext': { workspaceId: 'ws-1', branch: 'main', displayName: 'api', terminals: [] },
        'workspace.list': {
          workspaces: [{ ...workspace('/srv/api'), name: 'api', hostId: 'ssh:box' }],
          truncated: false
        }
      }
    })
  })
  assert.deepEqual((await remote.request('changes.get')).snapshot, {
    state: 'remote',
    workspace: 'api',
    host: 'ssh'
  })
  await remote.deactivate()
})

// Ids as Orca 1.4.x reports them: readContext names a workspace `<projectId>::<path>`, while
// workspace.list names worktrees `identity:wt2:…` and gives the projectId and path separately.
const row = (
  id: string,
  projectId: string,
  name: string,
  path: string,
  branch: string,
  hostId = 'local'
) => ({
  id,
  kind: 'worktree' as const,
  name,
  projectId,
  path,
  branch,
  hostId
})
const ORCA_LIST = [
  row('identity:wt2:local:aaa', 'p-shop', 'main', '/w/shop', 'main'),
  row('identity:wt2:local:bbb', 'p-blog', 'main', '/w/blog', 'main'),
  row('identity:wt2:local:ccc', 'p-shop', 'demo', '/w/shop-demo', 'feature/demo'),
  row('identity:wt2:ssh:ddd', 'p-remote', 'main', '/w/shop', 'main', 'ssh:ssh-1794-abc'),
  row('identity:wt2:runtime:eee', 'p-server', 'api', '/srv/api', 'main', 'runtime:box')
]
const focus = (workspaceId: string, displayName: string, branch: string) => ({
  workspaceId,
  displayName,
  branch,
  terminals: []
})

test('pickWorkspace: a worktree is found by its projectId and path, whatever its name', () => {
  assert.equal(
    pickWorkspace(focus('p-shop::/w/shop-demo', 'demo', 'refs/heads/feature/demo'), ORCA_LIST),
    ORCA_LIST[2]
  )
  // Three workspaces called main on main: the id still says which.
  assert.equal(pickWorkspace(focus('p-blog::/w/blog', 'main', 'refs/heads/main'), ORCA_LIST), ORCA_LIST[1])
  // Same path on this Mac and over SSH: the projectId decides.
  assert.equal(pickWorkspace(focus('p-remote::/w/shop', 'main', 'refs/heads/main'), ORCA_LIST), ORCA_LIST[3])
})

test('pickWorkspace: never guesses between workspaces with the same name and branch', () => {
  assert.equal(pickWorkspace(focus('p-unknown::/elsewhere', 'main', 'refs/heads/main'), ORCA_LIST), null)
})

test('remote workspaces say where they are instead of showing another repo', async () => {
  const ask = async (ctx: ReturnType<typeof focus>) => {
    const worker = await mountWorker(main, {
      host: mockHost({
        results: {
          'workspace.readContext': ctx,
          'workspace.list': { workspaces: ORCA_LIST, truncated: false }
        }
      })
    })
    const { focus, snapshot: snap } = await worker.request('changes.get')
    assert.equal(focus, ctx.workspaceId, 'the answer names the workspace the worker read')
    await worker.deactivate()
    return snap
  }
  assert.deepEqual(await ask(focus('p-remote::/w/shop', 'main', 'refs/heads/main')), {
    state: 'remote',
    workspace: 'main',
    host: 'ssh'
  })
  assert.deepEqual(await ask(focus('p-server::/srv/api', 'api', 'refs/heads/main')), {
    state: 'remote',
    workspace: 'api',
    host: 'server'
  })
  // Focused, but not in Orca's list: say so rather than "No workspace open".
  assert.deepEqual(await ask(focus('p-unknown::/elsewhere', 'main', 'refs/heads/main')), {
    state: 'unknown-workspace',
    workspace: 'main'
  })
})

test('pickWorkspace: id first, then a unique name and branch', () => {
  const a = { id: 'a', name: 'shop', path: '/a', branch: 'main', hostId: null }
  const b = { id: 'b', name: 'shop', path: '/b', branch: 'main', hostId: null }
  const ctx = (workspaceId?: string) => ({ workspaceId, branch: 'main', displayName: 'shop' })
  assert.equal(pickWorkspace(ctx('b'), [a, b]), b)
  assert.equal(pickWorkspace(ctx(), [a]), a)
  assert.equal(pickWorkspace(ctx(), [a, b]), null)
  assert.equal(pickWorkspace(null, [a]), null)
})

test('opens a file through Orca’s editor', async () => {
  const repo = makeRepo()
  try {
    const host = mockHost({
      results: {
        'workspace.list': { workspaces: [workspace(repo)], truncated: false },
        'editor.open': { opened: true }
      }
    })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('changes.open', { workspaceId: 'ws-1', path: 'src/lib.rs' }), {
      opened: true
    })
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: 'src/lib.rs' }])
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('toWorkspacePath: relative to the workspace, null outside it', () => {
  assert.equal(toWorkspacePath('/r', '/r', 'src/lib.rs'), 'src/lib.rs')
  assert.equal(toWorkspacePath('/r', '/r/src', 'src/lib.rs'), 'lib.rs')
  assert.equal(toWorkspacePath('/r', '/r/src', 'README.md'), null)
  assert.equal(toWorkspacePath('/r', '/r/src', 'srcfoo/a.rs'), null)
  assert.equal(toWorkspacePath('/r', '/r/src', 'src'), null)
})

test('opens a file relative to a workspace that is a subfolder of its repository', async () => {
  const repo = makeRepo()
  try {
    // A folder workspace on `src/`: the panel's paths are repo-relative, editor.open wants workspace-relative.
    const sub = { ...workspace(join(repo, 'src')), kind: 'folder' }
    const host = mockHost({
      results: {
        'workspace.list': { workspaces: [sub], truncated: false },
        'editor.open': { opened: true }
      }
    })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('changes.open', { workspaceId: 'ws-1', path: 'src/lib.rs' }), {
      opened: true
    })
    // Outside the workspace: Orca would refuse it, so the worker never asks.
    assert.deepEqual(await worker.request('changes.open', { workspaceId: 'ws-1', path: 'README.md' }), {
      opened: false
    })
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: 'lib.rs' }])
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

// changes.diff: the file's patch is written into the workspace (git-ignored) and opened in Orca.

const PATCH = '.diff-breakdown/src/lib.rs.breakdown.diff'

function diffHost(ws: ReturnType<typeof workspace>) {
  return mockHost({
    results: {
      'workspace.readContext': {
        workspaceId: 'ws-1',
        branch: 'feature',
        displayName: 'feature',
        terminals: []
      },
      'workspace.list': { workspaces: [ws], truncated: false },
      'editor.open': { opened: true }
    }
  })
}

test('changes.diff writes the file’s patch into a git-ignored folder and opens it', async () => {
  const repo = makeRepo()
  try {
    const host = diffHost(workspace(repo))
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('changes.diff', { workspaceId: 'ws-1', path: 'src/lib.rs' }), {
      opened: true,
      view: 'diff'
    })
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: PATCH }])
    assert.match(readFileSync(join(repo, PATCH), 'utf8'), /^\+pub fn two\(\) \{\}$/m)
    assert.equal(readFileSync(join(repo, '.diff-breakdown/.gitignore'), 'utf8'), '*\n')
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    assert.ok(!status.includes('.diff-breakdown'), status)
    // The panel never counts its own patches.
    const snap = (await worker.request('changes.get')).snapshot
    assert.ok(snap.state === 'ok')
    if (snap.state !== 'ok') return
    const paths = snap.groups.flatMap((g) => g.files.map((f) => f.path))
    assert.ok(!paths.some((p) => p.startsWith('.diff-breakdown')), paths.join(', '))
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('changes.diff opens a binary file itself, and refuses a file that has not changed', async () => {
  const repo = makeRepo()
  try {
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
    const host = diffHost(workspace(repo))
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('changes.diff', { workspaceId: 'ws-1', path: 'logo.png' }), {
      opened: true,
      view: 'file'
    })
    assert.deepEqual(await worker.request('changes.diff', { workspaceId: 'ws-1', path: 'Cargo.toml' }), {
      opened: false
    })
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: 'logo.png' }])
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('an open patch follows the file on each poll, and is left alone when nothing changed', async () => {
  const repo = makeRepo()
  try {
    const worker = await mountWorker(main, { host: diffHost(workspace(repo)) })
    await worker.request('changes.diff', { workspaceId: 'ws-1', path: 'src/lib.rs' })

    writeFileSync(join(repo, 'src/lib.rs'), 'pub fn one() {}\npub fn two() {}\npub fn three() {}\n')
    await worker.request('changes.get')
    assert.match(readFileSync(join(repo, PATCH), 'utf8'), /^\+pub fn three\(\) \{\}$/m)

    const written = statSync(join(repo, PATCH)).mtimeMs
    await worker.request('changes.get')
    assert.equal(statSync(join(repo, PATCH)).mtimeMs, written, 'an unchanged patch was rewritten')

    // Back to the base branch's text: no longer a change.
    writeFileSync(join(repo, 'src/lib.rs'), 'pub fn one() {}\n')
    await worker.request('changes.get')
    assert.match(readFileSync(join(repo, PATCH), 'utf8'), /^No changes against main/m)
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('changes.diff in a subfolder workspace shows even files outside it', async () => {
  const repo = makeRepo()
  try {
    const host = diffHost({ ...workspace(join(repo, 'src')), kind: 'folder' })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('changes.diff', { workspaceId: 'ws-1', path: 'README.md' }), {
      opened: true,
      view: 'diff'
    })
    assert.deepEqual(host.callsOf('editor.open'), [
      { workspaceId: 'ws-1', path: '.diff-breakdown/README.md.breakdown.diff' }
    ])
    assert.match(
      readFileSync(join(repo, 'src/.diff-breakdown/README.md.breakdown.diff'), 'utf8'),
      /^\+Now with two\.$/m
    )
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

// Cleanup: at most MAX_PATCHES patches per workspace, least recently opened out first.

const name = (i: number) => `f${String(i).padStart(2, '0')}.txt`
const patchFile = (repo: string, path: string) => join(repo, '.diff-breakdown', `${path}.breakdown.diff`)

test('keeps at most MAX_PATCHES patches, dropping the least recently opened and its empty folders', async () => {
  const repo = makeRepo()
  try {
    for (let i = 0; i <= MAX_PATCHES; i++) writeFileSync(join(repo, name(i)), `${i}\n`)
    const worker = await mountWorker(main, { host: diffHost(workspace(repo)) })
    const open = (path: string) => worker.request('changes.diff', { workspaceId: 'ws-1', path })

    await open('migrations/0001_init.sql') // the oldest, in a folder of its own
    await open('src/lib.rs')
    for (let i = 0; i < MAX_PATCHES - 2; i++) await open(name(i))
    await open('src/lib.rs') // reopened: now the most recent
    await open(name(MAX_PATCHES - 2)) // one over the cap

    assert.ok(!existsSync(patchFile(repo, 'migrations/0001_init.sql')), 'the oldest patch is deleted')
    assert.ok(!existsSync(join(repo, '.diff-breakdown/migrations')), 'its empty folder is deleted')
    assert.ok(existsSync(patchFile(repo, 'src/lib.rs')), 'a reopened patch is kept')
    assert.ok(existsSync(patchFile(repo, name(MAX_PATCHES - 2))))
    assert.ok(existsSync(join(repo, '.diff-breakdown/.gitignore')))
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a restarted worker keeps refreshing the patches it finds, so open diff tabs stay live', async () => {
  const repo = makeRepo()
  try {
    const first = await mountWorker(main, { host: diffHost(workspace(repo)) })
    await first.request('changes.diff', { workspaceId: 'ws-1', path: 'src/lib.rs' })
    await first.deactivate()

    writeFileSync(join(repo, 'src/lib.rs'), 'pub fn one() {}\npub fn two() {}\npub fn three() {}\n')
    const second = await mountWorker(main, { host: diffHost(workspace(repo)) })
    await second.request('changes.get')
    assert.ok(existsSync(join(repo, PATCH)), 'a restart must not delete open patches')
    assert.match(readFileSync(join(repo, PATCH), 'utf8'), /^\+pub fn three\(\) \{\}$/m)
    await second.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('patches left over beyond the cap are trimmed, oldest first, when a worker finds them', async () => {
  const repo = makeRepo()
  try {
    const now = Date.now() / 1000
    for (let i = 0; i < MAX_PATCHES + 2; i++) {
      const file = patchFile(repo, name(i))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, 'old\n')
      utimesSync(file, now - 1000 + i, now - 1000 + i) // f00 oldest
    }
    const worker = await mountWorker(main, { host: diffHost(workspace(repo)) })
    await worker.request('changes.get')
    assert.ok(!existsSync(patchFile(repo, name(0))))
    assert.ok(!existsSync(patchFile(repo, name(1))))
    assert.ok(existsSync(patchFile(repo, name(2))))
    assert.ok(existsSync(patchFile(repo, name(MAX_PATCHES + 1))))
    await worker.deactivate()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('groupFiles classifies each file once', () => {
  const files = ['a.rs', 'b_test.rs', 'c.md', 'd.rs'].map((path) => ({
    path,
    status: 'M' as const,
    added: 1,
    deleted: 0
  }))
  let calls = 0
  const groups = groupFiles(files, (path) => {
    calls++
    return path.endsWith('.md') ? 'docs' : path.includes('_test') ? 'tests' : 'runtime'
  })
  assert.equal(calls, files.length)
  assert.deepEqual(
    groups.map((g) => [g.id, g.files.length, g.added]),
    [
      ['runtime', 2, 2],
      ['tests', 1, 1],
      ['docs', 1, 1]
    ]
  )
})
