# Diff Breakdown

An [Orca](https://github.com/stablyai/orca) sidebar panel that sorts a branch's changes by kind, so
you can tell at a glance whether it's mostly code, mostly tests, or hiding a migration.

<img src="assets/panels.png" width="864" alt="The Diff Breakdown panel twice: collapsed, with a share bar and one row per kind of change, and with three groups open, listing their files with folder, lines changed and status">

Kinds: Runtime, Tests, Contracts, DB migrations, CI/CD, Config & rollout, Dependencies and Docs.
Generated files are listed but not counted.

It compares everything in the working tree (committed, staged, unstaged and untracked) with the
branch's base: `origin/HEAD`, else `origin/main`, `origin/master`, `main` or `master`.

## Install

```sh
orca plugin install adamthewilliam/orca-diff-breakdown
```

Orca lists what the plugin can access and prints the same command with `--approve <fingerprint>`.
Run that, then open the panel: show the right sidebar with the button in the top-right corner of
the window, then click the layers icon in the sidebar's tab bar.

<img src="assets/where-to-find.png" width="334" alt="The top of Orca's right sidebar, with the sidebar toggle in the top-right corner and the Diff Breakdown layers icon in the tab bar circled">

It reads which workspace is focused, runs read-only `git` in it, and opens a file in Orca's editor
when you click it.

## Customise

### Settings

In Settings → Plugins → Diff Breakdown:

- `Compare against`: the base ref, such as `origin/develop`. Empty picks one as above.
- `Auto refresh (seconds)`: 10 by default. 0 refreshes only when you switch workspace or
  return to the panel.

### Categories

Add `.orca/diff-breakdown.json` at the repo root. Contracts are the usual thing to set:

```json
{
  "rules": [
    { "category": "contracts", "paths": ["crates/domain/**", "packages/api-types/**"] },
    { "category": "tests", "paths": ["apps/desktop/src/**/*_tests.rs"] }
  ]
}
```

- `category`: `runtime`, `tests`, `contracts`, `migrations`, `cicd`, `config`, `dependencies`,
  `docs` or `generated`.
- `paths`: case-insensitive globs. Without a `/` a glob matches the file name in any folder
  (`*.proto`); with one it's anchored at the repo root. `**` crosses folders, `*` doesn't.
- `"presets": false` drops the built-in rules and keeps only yours.

Your rules win. Next comes `.gitattributes` (`linguist-generated` and `linguist-vendored` mean
Generated, `linguist-documentation` means Docs), then built-in presets for Rust, TypeScript/JavaScript,
Python, Go, JVM, .NET, Swift, Ruby, PHP and Elixir. Files named `*.gen.*` or `*.generated.*`, or in a
`__generated__` folder, count as Generated in every repo. Anything left over is Runtime.

## Limits

- Categories are per file, so Rust's inline `#[cfg(test)]` modules count as Runtime.
- Only repositories on your computer are read. Remote workspaces, on SSH hosts or paired Orca servers, aren't supported yet: the panel says so and points you to Source Control.

## Develop

No build step: Orca transpiles the TypeScript when it loads.

```sh
bun install && orca plugin types .
bun run typecheck && bun run lint && orca plugin test .
orca plugin dev watch .   # load into Orca and stream logs; Ctrl-C unloads
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull requests and releases.

## Credits

File icons are [Catppuccin for VSCode Icons](https://github.com/catppuccin/vscode-icons) (MIT),
in Catppuccin's Mocha colours on dark themes and Latte on light ones. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
