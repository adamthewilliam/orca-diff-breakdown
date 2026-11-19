// The plugin's worker: finds the focused workspace's folder, reads its changes with git and groups
// them by category for the panel. Orca transpiles this file when it loads; no build step.
import type { HostResult } from 'orca/host'
import type { OrcaWorkerApi } from 'orca/worker'
import { CATEGORIES } from './categories'
import { createClassifier, detectEcosystems, parseOverrides, type Overrides } from './classify'
import {
  OVERRIDES_PATH,
  changedFiles,
  currentBranch,
  linguistAttributes,
  markerFiles,
  readOverridesFile,
  repoRoot,
  resolveBase
} from './git'
import type { CategoryGroup, CategoryId, ChangedFile, ChangesAnswer, ChangesSnapshot } from './protocol'

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

/** Reads the changes of the workspace `context` names. */
async function snapshot(orca: OrcaWorkerApi, context: Context): Promise<ChangesSnapshot> {
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

  const configuredBase = String((await orca.settings.get('baseRef')) ?? '').trim()
  const [base, branch, markers, overridesText] = await Promise.all([
    resolveBase(root, configuredBase),
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
  orca.panels.handle('changes.get', async (): Promise<ChangesAnswer> => {
    // `focus` is known as soon as Orca answers, so even an error says which workspace it is for.
    let focus: string | null = null
    try {
      const context = await orca.host.call('workspace.readContext', {})
      focus = context?.workspaceId ?? null
      return { focus, snapshot: await snapshot(orca, context) }
    } catch (error) {
      const message = (error as Error).message.split('\n').find(Boolean) ?? 'git failed'
      orca.log(`changes.get failed: ${message}`)
      return { focus, snapshot: { state: 'error', message } }
    }
  })

  orca.panels.handle('changes.open', async ({ workspaceId, path }) => {
    await orca.host.call('editor.open', { workspaceId, path })
    return { opened: true }
  })
}
