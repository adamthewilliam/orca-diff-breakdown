// How the panel header shortens a branch name to fit. Pure: no DOM.

/**
 * Versions of `feature/branch-history → origin/main`, longest first. Each drops the least useful
 * part that is left: the base (or ` (no base)` when there is none), then the prefix (abbreviated to
 * initials, then gone). The branch's own name goes last, and only by CSS's ellipsis when not even it fits.
 */
export function branchVersions(branch: string, base: string | null): [text: string, muted: string][] {
  const slash = branch.lastIndexOf('/')
  const name = branch.slice(slash + 1)
  const prefix = slash === -1 ? '' : branch.slice(0, slash + 1)
  const initials = prefix.replace(/([^/])[^/]*\//g, '$1/')
  const versions: [string, string][] = [
    [branch, base ? ` → ${base}` : ' (no base)'],
    [branch, '']
  ]
  if (initials && initials !== prefix) versions.push([initials + name, ''])
  if (prefix) versions.push([name, ''])
  return versions
}
