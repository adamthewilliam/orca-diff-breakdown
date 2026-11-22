// The patch files behind the diff view. Orca's editor opens only files inside a workspace, so each
// patch is written to a folder of the workspace that git-ignores itself, out of git's and the panel's way.
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, sep } from 'node:path'

export const PATCH_DIR = '.diff-breakdown'
/** Patches kept per workspace. Orca says nothing when a tab closes, so the least recently opened go first. */
export const MAX_PATCHES = 20

/** A suffix of its own, so the diff editor never claims a user's own `.diff` files. */
export const PATCH_SUFFIX = '.breakdown.diff'

/** Workspace-relative path of a repo file's patch; it mirrors the repo's folders so names never collide. */
export function patchPath(repoPath: string): string {
  return posix.join(PATCH_DIR, repoPath + PATCH_SUFFIX)
}

/** What an open patch says once its file matches the base again. */
export function noChangesText(base: string | null): string {
  return `No changes against ${base ?? 'HEAD'} now.\n`
}

/**
 * Writes a patch into the workspace unless it already holds `text`, so an open diff redraws only on a
 * real change. Returns whether it wrote.
 */
export async function writePatch(workspaceDir: string, relPath: string, text: string): Promise<boolean> {
  const file = join(workspaceDir, relPath)
  await mkdir(dirname(file), { recursive: true })
  // Rewritten when missing (a `git clean`, say): `*` keeps the whole folder out of git status.
  await writeIfChanged(join(workspaceDir, PATCH_DIR, '.gitignore'), '*\n')
  return writeIfChanged(file, text)
}

async function writeIfChanged(file: string, text: string): Promise<boolean> {
  const current = await readFile(file, 'utf8').catch(() => null)
  if (current === text) return false
  await writeFile(file, text)
  return true
}

/** Repo paths of the patches already in a workspace, oldest first (by when each was last written). */
export async function listPatches(workspaceDir: string): Promise<string[]> {
  const top = join(workspaceDir, PATCH_DIR)
  const found: { path: string; mtimeMs: number }[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith(PATCH_SUFFIX)) {
        const repoPath = relative(top, full).slice(0, -PATCH_SUFFIX.length).split(sep).join('/')
        found.push({ path: repoPath, mtimeMs: (await stat(full)).mtimeMs })
      }
    }
  }
  await walk(top)
  return found.sort((a, b) => a.mtimeMs - b.mtimeMs).map((f) => f.path)
}

/** Deletes a repo file's patch, then any folders that left empty, up to (not including) the patch folder. */
export async function removePatch(workspaceDir: string, repoPath: string): Promise<void> {
  const top = join(workspaceDir, PATCH_DIR)
  const file = join(workspaceDir, patchPath(repoPath))
  await rm(file, { force: true })
  for (let dir = dirname(file); dir.startsWith(top + sep); dir = dirname(dir)) {
    try {
      await rmdir(dir) // fails, and stops, at the first folder that still holds something
    } catch {
      break
    }
  }
}
