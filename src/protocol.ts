// The panel <-> worker contract, declared once: panel/main.ts and src/worker.ts both read it.

export type CategoryId =
  | 'runtime'
  | 'tests'
  | 'contracts'
  | 'migrations'
  | 'cicd'
  | 'config'
  | 'dependencies'
  | 'docs'
  | 'generated'

/** `U` is untracked; the rest are git's name-status letters. */
export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'

export type ChangedFile = {
  /** Repository-relative path, after any rename. */
  path: string
  /** Set for renames and copies. */
  oldPath?: string
  status: FileStatus
  /** Null for binary files. */
  added: number | null
  deleted: number | null
}

export type CategoryGroup = {
  id: CategoryId
  name: string
  files: ChangedFile[]
  added: number
  deleted: number
}

export type ChangesSnapshot =
  | { state: 'no-workspace' }
  /** Orca has a workspace focused, but `workspace.list` has no row for it. */
  | { state: 'unknown-workspace'; workspace: string }
  /** Not on this machine: `ssh` over SSH, `server` on an Orca server. */
  | { state: 'remote'; workspace: string; host: 'ssh' | 'server' }
  | { state: 'not-git'; workspace: string; path: string }
  | { state: 'error'; message: string }
  | {
      state: 'ok'
      workspace: string
      workspaceId: string
      branch: string
      /** What the diff is against, e.g. `origin/main`; null when no base was found (working tree vs HEAD). */
      base: string | null
      /** Ecosystems whose presets were applied, e.g. ["Rust", "TypeScript/JavaScript"]. */
      ecosystems: string[]
      /** Repo-relative path of the overrides file, when the repo has one. */
      overrides: string | null
      /** Set when the overrides file exists but could not be used. */
      overridesError?: string
      /** Non-empty groups in display order; `generated` is last and left out of the totals. */
      groups: CategoryGroup[]
      added: number
      deleted: number
    }

/** What the worker read: `focus` is Orca's id for the focused workspace (readContext's `workspaceId`), null when none. */
export type ChangesAnswer = { focus: string | null; snapshot: ChangesSnapshot }

/** `changes.diff`'s answer: the diff opened, the file itself (binary), or nothing (not changed). */
export type DiffAnswer = { opened: false } | { opened: true; view: 'diff' | 'file' }

declare module 'orca' {
  interface PluginRequests {
    /** Changed files of the focused workspace against its base branch, grouped by category. */
    'changes.get': { output: ChangesAnswer }
    /** Opens a changed file of a workspace in Orca's editor. */
    'changes.open': { input: { workspaceId: string; path: string }; output: { opened: boolean } }
    /**
     * Opens a changed file's diff against the base in Orca's editor (`view: 'diff'`); a binary file
     * opens as itself (`view: 'file'`). `opened` is false for a file that has not changed.
     */
    'changes.diff': {
      input: { workspaceId: string; path: string }
      output: DiffAnswer
    }
  }
}
