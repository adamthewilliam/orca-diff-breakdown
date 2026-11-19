// Turns paths into categories: repo overrides, then .gitattributes, then the presets. Pure: no I/O.
import { CATEGORIES, COMMON_RULES, ECOSYSTEMS, PRECEDENCE, isCategoryId, type Ecosystem } from './categories'
import type { CategoryId } from './protocol'

/**
 * A glob as a case-insensitive RegExp over a repo-relative path. A pattern without `/` matches the
 * file name in any folder; one with `/` is anchored at the repo root. `**` crosses folders, `*` and
 * `?` do not, `{a,b}` is either.
 */
export function globToRegExp(glob: string): RegExp {
  const anchored = glob.includes('/')
  const body = translate(glob.replace(/^\/+/, ''))
  return new RegExp('^' + (anchored ? '' : '(?:.*/)?') + body + '$', 'i')
}

/** A glob's RegExp source; each `{a,b}` alternative is translated the same way (not nested). */
function translate(pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      const slashAfter = pattern[i + 2] === '/'
      out += slashAfter ? '(?:.*/)?' : '.*'
      i += slashAfter ? 2 : 1
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else if (ch === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) out += '\\{'
      else {
        out +=
          '(?:' +
          pattern
            .slice(i + 1, end)
            .split(',')
            .map(translate)
            .join('|') +
          ')'
        i = end
      }
    } else out += escape(ch)
  }
  return out
}

function escape(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** A rule of the overrides file, its globs compiled. */
export type OverrideRule = { category: CategoryId; patterns: RegExp[] }
export type Overrides = { rules: OverrideRule[]; presets: boolean }

/** Parses `.orca/diff-breakdown.json`; throws a message naming what is wrong. */
export function parseOverrides(text: string): Overrides {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`not valid JSON (${(error as Error).message})`)
  }
  if (!isRecord(data)) throw new Error('expected a JSON object')
  const presets = data.presets ?? true
  if (typeof presets !== 'boolean') throw new Error('"presets" must be true or false')
  const rawRules = data.rules ?? []
  if (!Array.isArray(rawRules)) throw new Error('"rules" must be a list')
  const rules = rawRules.map((rule, index): OverrideRule => {
    if (!isRecord(rule)) throw new Error(`rules[${index}] must be an object`)
    const { category, paths } = rule
    if (!isCategoryId(category)) {
      throw new Error(`rules[${index}].category must be one of ${CATEGORIES.map((c) => c.id).join(', ')}`)
    }
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || p === '')) {
      throw new Error(`rules[${index}].paths must be a list of globs`)
    }
    const patterns = paths.map((glob: string, j) => {
      try {
        return globToRegExp(glob)
      } catch (error) {
        throw new Error(`rules[${index}].paths[${j}]: ${(error as Error).message}`)
      }
    })
    return { category, patterns }
  })
  return { rules, presets }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Folders whose manifests describe sample or third-party code, not the repo's own. */
const NOT_OWN_CODE =
  /(^|\/)(tests?|fixtures?|testdata|__tests__|examples?|samples?|vendor|third_party|node_modules)\//i

/** The ecosystems whose marker file names appear among the repo's own files. */
export function detectEcosystems(repoFiles: readonly string[]): Ecosystem[] {
  const own = repoFiles.filter((path) => !NOT_OWN_CODE.test(path))
  const names = [...new Set(own.map((path) => path.slice(path.lastIndexOf('/') + 1)))]
  return ECOSYSTEMS.filter((eco) =>
    eco.markers.map(globToRegExp).some((re) => names.some((name) => re.test(name)))
  )
}

/** linguist attributes git reports for a path. */
export type PathAttributes = { generated?: boolean; vendored?: boolean; documentation?: boolean }

export type Classifier = (path: string) => CategoryId

export function createClassifier(options: {
  ecosystems: readonly Ecosystem[]
  overrides?: Overrides
  attributes?: ReadonlyMap<string, PathAttributes>
}): Classifier {
  const overrideRules = options.overrides?.rules ?? []
  const usePresets = options.overrides?.presets ?? true
  const presetRules = usePresets
    ? PRECEDENCE.map((category) => ({
        category,
        patterns: [
          ...(COMMON_RULES[category] ?? []),
          ...options.ecosystems.flatMap((eco) => eco.rules[category] ?? [])
        ].map(globToRegExp)
      }))
    : []
  const attributes = options.attributes ?? new Map()

  return (path) => {
    for (const rule of overrideRules) if (rule.patterns.some((re) => re.test(path))) return rule.category
    const attrs = attributes.get(path)
    if (attrs?.generated || attrs?.vendored) return 'generated'
    if (attrs?.documentation) return 'docs'
    for (const rule of presetRules) if (rule.patterns.some((re) => re.test(path))) return rule.category
    return 'runtime'
  }
}
