// The plugin's worker: finds the focused workspace's folder, reads its changes with git and groups
// them by category for the panel. Orca transpiles this file when it loads; no build step.
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
import type { CategoryGroup, ChangedFile, ChangesSnapshot } from './protocol'

type Workspace = {
  id: string
  name: string
  path: string
  branch: string | null
  hostId: string | null
}
type Context = { workspaceId?: string; branch: string; displayName: string } | null

/**
 * The focused workspace as `workspace.list` describes it. Matches by id first, then by name and
 * branch; when several match by name and branch, the result is ambiguous and null.
 */
export function pickWorkspace(context: Context, workspaces: readonly Workspace[]): Workspace | null {
  if (!context) return null
  const byId = context.workspaceId ? workspaces.find((w) => w.id === context.workspaceId) : undefined
  if (byId) return byId
  const same = workspaces.filter(
    (w) => w.name === context.displayName && (w.branch ?? '') === (context.branch ?? '')
  )
  return same.length === 1 ? same[0] : null
}

/** Groups files in display order, leaving out empty categories. */
export function groupFiles(
  files: readonly ChangedFile[],
  classify: (path: string) => string
): CategoryGroup[] {
  return CATEGORIES.map(({ id, name }) => {
    const members = files.filter((f) => classify(f.path) === id)
    return {
      id,
      name,
      files: members,
      added: members.reduce((sum, f) => sum + (f.added ?? 0), 0),
      deleted: members.reduce((sum, f) => sum + (f.deleted ?? 0), 0)
    }
  }).filter((group) => group.files.length > 0)
}

async function snapshot(orca: OrcaWorkerApi): Promise<ChangesSnapshot> {
  const context = (await orca.host.call('workspace.readContext', {})) as Context
  const { workspaces } = (await orca.host.call('workspace.list', {})) as {
    workspaces: Workspace[]
  }
  const workspace = pickWorkspace(context, workspaces)
  if (!workspace) return { state: 'no-workspace' }
  if (workspace.hostId && workspace.hostId !== 'local') {
    return { state: 'remote', workspace: workspace.name }
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
  orca.panels.handle('changes.get', async (): Promise<ChangesSnapshot> => {
    try {
      return await snapshot(orca)
    } catch (error) {
      const message = (error as Error).message.split('\n').find(Boolean) ?? 'git failed'
      orca.log(`changes.get failed: ${message}`)
      return { state: 'error', message }
    }
  })

  orca.panels.handle('changes.open', async ({ workspaceId, path }) => {
    await orca.host.call('editor.open', { workspaceId, path })
    return { opened: true }
  })
}
