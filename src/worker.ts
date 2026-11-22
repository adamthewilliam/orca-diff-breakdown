// The plugin's worker: finds the focused workspace's folder, reads its changes with git and groups
// them by category for the panel. Orca transpiles this file when it loads; no build step.
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { HostResult } from 'orca/host'
import type { OrcaWorkerApi } from 'orca/worker'
import { CATEGORIES } from './categories'
import { createClassifier, detectEcosystems, parseOverrides, type Overrides } from './classify'
import {
  OVERRIDES_PATH,
  changedFiles,
  currentBranch,
  filePatch,
  linguistAttributes,
  markerFiles,
  readOverridesFile,
  repoRoot,
  resolveBase
} from './git'
import { MAX_PATCHES, listPatches, noChangesText, patchPath, removePatch, writePatch } from './patches'
import type {
  CategoryGroup,
  CategoryId,
  ChangedFile,
  ChangesAnswer,
  ChangesSnapshot,
  DiffAnswer
} from './protocol'

/** The fields of a `workspace.list` row the worker reads. */
type Workspace = Pick<
  HostResult<'workspace.list'>['workspaces'][number],
  'id' | 'projectId' | 'name' | 'path' | 'branch' | 'hostId'
>
/** What `workspace.readContext` answers, as far as the worker reads it. */
type Context = Pick<
  NonNullable<HostResult<'workspace.readContext'>>,
  'workspaceId' | 'branch' | 'displayName'
> | null

/** A branch without any leading `refs/heads/`. */
const shortBranch = (branch: string | null | undefined) => (branch ?? '').replace(/^refs\/heads\//, '')

/**
 * The focused workspace as `workspace.list` describes it. Matches by row id, then by the
 * `<projectId>::<path>` the context id is made of, then by name and branch when exactly one row
 * matches; otherwise null.
 */
export function pickWorkspace<W extends Workspace>(context: Context, workspaces: readonly W[]): W | null {
  if (!context) return null
  const id = context.workspaceId
  if (id) {
    const byId = workspaces.find((w) => w.id === id)
    if (byId) return byId
    const split = id.indexOf('::')
    if (split >= 0) {
      const projectId = id.slice(0, split)
      const path = id.slice(split + 2)
      const byPath = workspaces.find((w) => w.projectId === projectId && w.path === path)
      if (byPath) return byPath
    }
  }
  const same = workspaces.filter(
    (w) => w.name === context.displayName && shortBranch(w.branch) === shortBranch(context.branch)
  )
  return same.length === 1 ? same[0] : null
}

/**
 * A repo-relative path as `editor.open` wants it: relative to the workspace folder, which can be a
 * subfolder of the repository. Null when the file lies outside the workspace.
 */
export function toWorkspacePath(
  root: string,
  workspacePath: string,
  repoRelativePath: string
): string | null {
  const path = relative(workspacePath, join(root, repoRelativePath))
  const outside = path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
  return outside ? null : path
}

/** Groups files in display order, leaving out empty categories. Classifies each file once. */
export function groupFiles(
  files: readonly ChangedFile[],
  classify: (path: string) => CategoryId
): CategoryGroup[] {
  const byCategory = new Map<CategoryId, ChangedFile[]>()
  for (const file of files) {
    const id = classify(file.path)
    const members = byCategory.get(id)
    if (members) members.push(file)
    else byCategory.set(id, [file])
  }
  const groups: CategoryGroup[] = []
  for (const { id, name } of CATEGORIES) {
    const members = byCategory.get(id)
    if (!members) continue
    groups.push({
      id,
      name,
      files: members,
      added: members.reduce((sum, f) => sum + (f.added ?? 0), 0),
      deleted: members.reduce((sum, f) => sum + (f.deleted ?? 0), 0)
    })
  }
  return groups
}

/** Diff patches this worker wrote, by workspace, so each poll can keep them current. */
type PatchRegistry = ReturnType<typeof createPatchRegistry>

function createPatchRegistry() {
  /** Per workspace, the repo paths with a patch, least recently opened first. */
  const written = new Map<string, Set<string>>()

  /**
   * A workspace's patches, adopting those already on disk the first time: a restarted worker keeps
   * refreshing the diff tabs still open instead of deleting them. Trims anything over the cap.
   */
  async function patchesOf(workspaceId: string, workspaceDir: string): Promise<Set<string>> {
    let paths = written.get(workspaceId)
    if (!paths) {
      paths = new Set(await listPatches(workspaceDir))
      written.set(workspaceId, paths)
      await trim(paths, workspaceDir)
    }
    return paths
  }

  async function trim(paths: Set<string>, workspaceDir: string): Promise<void> {
    for (const oldest of [...paths].slice(0, Math.max(0, paths.size - MAX_PATCHES))) {
      paths.delete(oldest)
      await removePatch(workspaceDir, oldest)
    }
  }

  return {
    /** Marks a patch as just opened, dropping the least recently opened beyond the cap. */
    async remember(workspaceId: string, workspaceDir: string, path: string): Promise<void> {
      const paths = await patchesOf(workspaceId, workspaceDir)
      paths.delete(path) // re-added below, as the most recent
      paths.add(path)
      await trim(paths, workspaceDir)
    },
    /** Rewrites this workspace's patches from a fresh read; unchanged ones are left alone. */
    async refresh(
      workspaceId: string,
      workspaceDir: string,
      root: string,
      base: string | null,
      files: readonly ChangedFile[]
    ): Promise<void> {
      const paths = await patchesOf(workspaceId, workspaceDir)
      const byPath = new Map(files.map((f) => [f.path, f]))
      for (const path of paths) {
        const file = byPath.get(path)
        const patch = file ? await filePatch(root, base, file) : null
        const text = patch ?? (file ? `${path} is now a binary file.\n` : noChangesText(base))
        await writePatch(workspaceDir, patchPath(path), text)
      }
    }
  }
}

async function configuredBase(orca: OrcaWorkerApi): Promise<string> {
  return String((await orca.settings.get('baseRef')) ?? '').trim()
}

/** A local workspace by id, with its repository's top folder; null when unknown or not in git. */
async function locate(orca: OrcaWorkerApi, workspaceId: string) {
  const { workspaces } = await orca.host.call('workspace.list', {})
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return null
  const root = await repoRoot(workspace.path)
  return root ? { workspace, root } : null
}

/** Opens a repo file in Orca's editor; false when it lies outside the workspace, which Orca refuses. */
async function openRepoFile(
  orca: OrcaWorkerApi,
  workspaceId: string,
  workspacePath: string,
  root: string,
  path: string
): Promise<boolean> {
  // git answers with symlinks resolved (macOS `/tmp` is `/private/tmp`), so resolve the folder too.
  const relativePath = toWorkspacePath(root, await realpath(workspacePath), path)
  if (relativePath === null) return false
  await orca.host.call('editor.open', { workspaceId, path: relativePath })
  return true
}

/** Reads the changes of the workspace `context` names. */
async function snapshot(
  orca: OrcaWorkerApi,
  context: Context,
  patches: PatchRegistry
): Promise<ChangesSnapshot> {
  const { workspaces } = await orca.host.call('workspace.list', {})
  const workspace = pickWorkspace(context, workspaces)
  if (!workspace) {
    return context
      ? { state: 'unknown-workspace', workspace: context.displayName }
      : { state: 'no-workspace' }
  }
  if (workspace.hostId && workspace.hostId !== 'local') {
    const host = workspace.hostId.startsWith('ssh:') ? 'ssh' : 'server'
    return { state: 'remote', workspace: workspace.name, host }
  }

  const root = await repoRoot(workspace.path)
  if (!root) return { state: 'not-git', workspace: workspace.name, path: workspace.path }

  const [base, branch, markers, overridesText] = await Promise.all([
    resolveBase(root, await configuredBase(orca)),
    currentBranch(root),
    markerFiles(root),
    readOverridesFile(root)
  ])

  let overrides: Overrides | undefined
  let overridesError: string | undefined
  if (overridesText !== null) {
    try {
      overrides = parseOverrides(overridesText)
    } catch (error) {
      overridesError = `${OVERRIDES_PATH}: ${(error as Error).message}`
    }
  }

  const files = await changedFiles(root, base)
  try {
    await patches.refresh(workspace.id, workspace.path, root, base, files)
  } catch (error) {
    // A stale diff tab is better than no breakdown.
    orca.log(`refreshing diffs failed: ${(error as Error).message}`)
  }
  const ecosystems = detectEcosystems(markers)
  const classify = createClassifier({
    ecosystems,
    overrides,
    attributes: await linguistAttributes(
      root,
      files.map((f) => f.path)
    )
  })
  const groups = groupFiles(files, classify)
  const counted = groups.filter((g) => g.id !== 'generated')

  return {
    state: 'ok',
    workspace: workspace.name,
    workspaceId: workspace.id,
    branch: branch ?? workspace.branch ?? '',
    base,
    ecosystems: ecosystems.map((e) => e.name),
    overrides: overridesText === null ? null : OVERRIDES_PATH,
    ...(overridesError ? { overridesError } : {}),
    groups,
    added: counted.reduce((sum, g) => sum + g.added, 0),
    deleted: counted.reduce((sum, g) => sum + g.deleted, 0)
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  const patches = createPatchRegistry()

  orca.panels.handle('changes.get', async (): Promise<ChangesAnswer> => {
    // `focus` is known as soon as Orca answers, so even an error says which workspace it is for.
    let focus: string | null = null
    try {
      const context = await orca.host.call('workspace.readContext', {})
      focus = context?.workspaceId ?? null
      return { focus, snapshot: await snapshot(orca, context, patches) }
    } catch (error) {
      const message = (error as Error).message.split('\n').find(Boolean) ?? 'git failed'
      orca.log(`changes.get failed: ${message}`)
      return { focus, snapshot: { state: 'error', message } }
    }
  })

  orca.panels.handle('changes.open', async ({ workspaceId, path }) => {
    // The panel's paths are relative to the repository; `editor.open` wants them relative to the workspace.
    const found = await locate(orca, workspaceId)
    if (!found) return { opened: false }
    return { opened: await openRepoFile(orca, workspaceId, found.workspace.path, found.root, path) }
  })

  orca.panels.handle('changes.diff', async ({ workspaceId, path }): Promise<DiffAnswer> => {
    const found = await locate(orca, workspaceId)
    if (!found) return { opened: false }
    const { workspace, root } = found
    const base = await resolveBase(root, await configuredBase(orca))
    const file = (await changedFiles(root, base)).find((f) => f.path === path)
    if (!file) return { opened: false }
    const patch = await filePatch(root, base, file)
    if (patch === null) {
      // Binary: git has no lines to show, so open the file itself.
      const opened = await openRepoFile(orca, workspaceId, workspace.path, root, path)
      return opened ? { opened: true, view: 'file' } : { opened: false }
    }
    // The patch lives in the workspace, so even a file outside a subfolder workspace gets a diff.
    await writePatch(workspace.path, patchPath(path), patch)
    await patches.remember(workspaceId, workspace.path, path)
    await orca.host.call('editor.open', { workspaceId, path: patchPath(path) })
    return { opened: true, view: 'diff' }
  })
}
