// Reads a repository's changes with the git CLI. Parsers are exported for tests.
import { execFile } from 'node:child_process'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PathAttributes } from './classify'
import type { ChangedFile, FileStatus } from './protocol'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024
/** Untracked files larger than this are counted as binary rather than read. */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

export async function git(cwd: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_BUFFER, timeout: 20_000 })
    return stdout
  }
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, maxBuffer: MAX_BUFFER, timeout: 20_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
    child.stdin?.end(input)
  })
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await git(cwd, args)).trim()
  } catch {
    return null
  }
}

/** The repository's top folder, or null when `path` is not inside one. */
export function repoRoot(path: string): Promise<string | null> {
  return gitOrNull(path, ['rev-parse', '--show-toplevel'])
}

export function currentBranch(root: string): Promise<string | null> {
  return gitOrNull(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/**
 * The branch to compare against: the `baseRef` setting when given, else the remote's default
 * branch, else the first of origin/main, origin/master, main, master that exists. Null when none.
 */
export async function resolveBase(root: string, configured: string): Promise<string | null> {
  const candidates = configured ? [configured] : []
  const remoteHead = await gitOrNull(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remoteHead) candidates.push(remoteHead)
  candidates.push('origin/main', 'origin/master', 'main', 'master')
  for (const ref of candidates) {
    if (await gitOrNull(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref
  }
  return null
}

/**
 * Changed files from where HEAD left `base` to the working tree (committed, staged and unstaged),
 * plus untracked files. Without a base, the working tree against HEAD.
 */
export async function changedFiles(root: string, base: string | null): Promise<ChangedFile[]> {
  const from = base ? await gitOrNull(root, ['merge-base', base, 'HEAD']) : null
  const target =
    from ?? ((await gitOrNull(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) ? 'HEAD' : null)
  const tracked: ChangedFile[] = []
  if (target) {
    const [numstat, nameStatus] = await Promise.all([
      git(root, ['diff', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', target, '--']),
      git(root, ['diff', '--name-status', '-z', '-M', '--no-ext-diff', target, '--'])
    ])
    tracked.push(...mergeDiff(parseNameStatusZ(nameStatus), parseNumstatZ(numstat)))
  }
  const untracked = parseNulList(await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
  const counted = await Promise.all(untracked.map((path) => countUntracked(root, path)))
  return [...tracked, ...counted].sort((a, b) => a.path.localeCompare(b.path))
}

type NameStatus = { path: string; oldPath?: string; status: FileStatus }
type NumStat = { path: string; added: number | null; deleted: number | null }

export function parseNulList(out: string): string[] {
  return out.split('\0').filter(Boolean)
}

/** `git diff --name-status -z`: `M\0path\0`, or `R100\0old\0new\0` for renames and copies. */
export function parseNameStatusZ(out: string): NameStatus[] {
  const parts = out.split('\0')
  const rows: NameStatus[] = []
  for (let i = 0; i < parts.length;) {
    const code = parts[i++]
    if (!code) continue
    const letter = code[0] as FileStatus
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++]
      const path = parts[i++]
      rows.push({ path, oldPath, status: letter })
    } else {
      rows.push({ path: parts[i++], status: letter === 'U' ? 'M' : letter })
    }
  }
  return rows
}

/** `git diff --numstat -z`: `a\td\tpath\0`, or `a\td\t\0old\0new\0` for renames; `-` for binary. */
export function parseNumstatZ(out: string): NumStat[] {
  const parts = out.split('\0')
  const rows: NumStat[] = []
  for (let i = 0; i < parts.length;) {
    const head = parts[i++]
    if (!head) continue
    const [a, d, inlinePath] = head.split('\t')
    let path = inlinePath
    if (path === '') {
      i++ // old path
      path = parts[i++]
    }
    rows.push({ path, added: a === '-' ? null : Number(a), deleted: d === '-' ? null : Number(d) })
  }
  return rows
}

function mergeDiff(statuses: NameStatus[], stats: NumStat[]): ChangedFile[] {
  const byPath = new Map(stats.map((s) => [s.path, s]))
  return statuses.map((s) => {
    const stat = byPath.get(s.path)
    return { ...s, added: stat?.added ?? 0, deleted: stat?.deleted ?? 0 }
  })
}

async function countUntracked(root: string, path: string): Promise<ChangedFile> {
  const file: ChangedFile = { path, status: 'U', added: null, deleted: null }
  try {
    const handle = await open(join(root, path), 'r')
    try {
      const { size } = await handle.stat()
      if (size > MAX_UNTRACKED_BYTES) return file
      const bytes = await handle.readFile()
      if (bytes.subarray(0, 8000).includes(0)) return file
      const text = bytes.toString('utf8')
      const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      return { ...file, added: lines, deleted: 0 }
    } finally {
      await handle.close()
    }
  } catch {
    return file
  }
}

const MARKER_PATHSPECS = [
  'Cargo.toml',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'Pipfile',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  '*.csproj',
  '*.fsproj',
  '*.sln',
  'Package.swift',
  'Podfile',
  'Gemfile',
  'composer.json',
  'mix.exs'
].map((name) => `:(glob)**/${name}`)

/** Tracked files that mark an ecosystem (Cargo.toml, package.json, ...), anywhere in the repo. */
export async function markerFiles(root: string): Promise<string[]> {
  return parseNulList(await git(root, ['ls-files', '-z', '--', ...MARKER_PATHSPECS]))
}

const LINGUIST = ['linguist-generated', 'linguist-vendored', 'linguist-documentation'] as const

/** linguist-* attributes from .gitattributes, for the given paths; only paths with one set. */
export async function linguistAttributes(
  root: string,
  paths: string[]
): Promise<Map<string, PathAttributes>> {
  const result = new Map<string, PathAttributes>()
  if (paths.length === 0) return result
  const out = await git(root, ['check-attr', '-z', '--stdin', ...LINGUIST], paths.join('\0') + '\0')
  const parts = out.split('\0')
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const [path, attr, value] = [parts[i], parts[i + 1], parts[i + 2]]
    if (value !== 'set' && value !== 'true') continue
    const entry = result.get(path) ?? {}
    if (attr === 'linguist-generated') entry.generated = true
    if (attr === 'linguist-vendored') entry.vendored = true
    if (attr === 'linguist-documentation') entry.documentation = true
    result.set(path, entry)
  }
  return result
}

export const OVERRIDES_PATH = '.orca/diff-breakdown.json'

/** The overrides file's text, or null when the repo has none. */
export async function readOverridesFile(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, OVERRIDES_PATH), 'utf8')
  } catch {
    return null
  }
}
