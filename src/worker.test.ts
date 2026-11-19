// Runs the worker against a real temporary git repository, with Orca's host mocked.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { ChangesSnapshot } from './protocol'
import * as main from './worker'
import { pickWorkspace } from './worker'

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
    const snap = (await worker.request('changes.get')) as ChangesSnapshot
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
    const snap = (await worker.request('changes.get')) as ChangesSnapshot
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
  assert.deepEqual(await none.request('changes.get'), { state: 'no-workspace' })
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
  assert.deepEqual(await remote.request('changes.get'), { state: 'remote', workspace: 'api' })
  await remote.deactivate()
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
  const host = mockHost({ results: { 'editor.open': { opened: true } } })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('changes.open', { workspaceId: 'ws-1', path: 'src/lib.rs' }), {
    opened: true
  })
  assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'ws-1', path: 'src/lib.rs' }])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
