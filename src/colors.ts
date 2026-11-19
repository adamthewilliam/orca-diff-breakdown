// The panel's own colours, per Orca mode. Everything else comes from Orca's theme variables.
import type { CategoryId } from './protocol'

export type Mode = 'dark' | 'light'

/**
 * Data colours for the categories, told apart by lightness as well as hue (the names carry the
 * meaning). Each is at least 3:1 against Orca's default sidebar background in its mode.
 */
export const CATEGORY_COLORS: Record<Mode, Record<CategoryId, string>> = {
  dark: {
    runtime: '#5b8def',
    tests: '#f0a35e',
    contracts: '#b39af7',
    migrations: '#f2d675',
    cicd: '#3fa7c9',
    config: '#ef7fae',
    dependencies: '#9aa5b1',
    docs: '#7fc8c0',
    generated: '#6b6f76'
  },
  light: {
    runtime: '#2f6fe0',
    tests: '#d47616',
    contracts: '#7c55e0',
    migrations: '#b88a00',
    cicd: '#137f9f',
    config: '#c93a75',
    dependencies: '#66717d',
    docs: '#2a8f84',
    generated: '#868c94'
  }
}

/**
 * Orca's built-in git decoration colours (its client CSS: `.dark` and `:root`), used until Orca
 * passes `--orca-git-decoration-*` to plugin frames. Deletions fall back to `--orca-destructive`.
 */
export const GIT_COLORS: Record<Mode, { added: string; modified: string; untracked: string }> = {
  dark: { added: '#81b88b', modified: '#e2c08d', untracked: '#73c991' },
  light: { added: '#587c0c', modified: '#895503', untracked: '#007100' }
}
