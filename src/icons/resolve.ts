// Which Catppuccin icon a file gets, from its name alone.
import { FILE_EXTENSIONS, FILE_NAMES } from './associations'
import type { IconName } from './svgs'

/** Ours, before upstream's lists: config variants such as vite.config.screenshot.ts. */
const OUR_NAMES: [RegExp, IconName][] = [
  [/^vite\.config\.(?:[^.]+\.)*[cm]?[jt]s$/, 'vite'],
  [/^vitest\.config\.(?:[^.]+\.)*[cm]?[jt]s$/, 'vitest']
]

/**
 * A file name's icon: our additions, then the exact name, then the longest matching extension
 * ("test.tsx" before "tsx", "d.ts" before "ts"), then the plain file icon. Case doesn't matter.
 */
export function fileIcon(fileName: string): IconName {
  const name = fileName.toLowerCase()
  for (const [pattern, icon] of OUR_NAMES) if (pattern.test(name)) return icon
  // hasOwn, so a file named "constructor" doesn't find Object.prototype's.
  if (Object.hasOwn(FILE_NAMES, name)) return FILE_NAMES[name]
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const extension = parts.slice(i).join('.')
    if (Object.hasOwn(FILE_EXTENSIONS, extension)) return FILE_EXTENSIONS[extension]
  }
  return '_file'
}
