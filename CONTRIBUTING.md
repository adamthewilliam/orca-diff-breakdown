# Contributing

## Set up

You need [Orca](https://github.com/stablyai/orca) and [Bun](https://bun.sh).

```sh
bun install              # TypeScript and Node typings, for type-checking only
orca plugin types .      # Orca's typings, into .orca/types
orca plugin dev watch .  # load into Orca, stream logs and reloads; Ctrl-C unloads
```

The first load prints what the plugin can access and asks you to approve it. The panel and worker
have no build step: Orca transpiles the TypeScript when it loads, and reloads on save. The diff
editor does: it bundles `@pierre/diffs`, which Orca frames can't import, so after changing
`editor/diff.ts` or `editor/languages.ts` run `bun run build` and commit `editor/dist/` (Orca
installs from the git tree). To colour another language, add its Shiki id to `editor/languages.ts`;
`scripts/build-editor.ts` leaves every grammar and theme not listed there out of the bundle.

## Where things are

| File                  | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `src/categories.ts`   | Categories and the built-in path presets per ecosystem                   |
| `src/classify.ts`     | Overrides, `.gitattributes` and presets, turned into a category per path |
| `src/git.ts`          | The read-only `git` calls                                                |
| `src/worker.ts`       | Finds the focused workspace and answers the panel                        |
| `src/protocol.ts`     | The panel ↔ worker contract                                              |
| `src/colors.ts`       | The panel's own colours: categories, and git colours Orca doesn't pass   |
| `src/icons/`          | File icons: `resolve.ts` picks one; the rest is generated (see below)    |
| `src/patches.ts`      | The git-ignored patch files the diff editor opens, and their cleanup     |
| `panel/main.ts`       | The sidebar panel                                                        |
| `editor/diff.ts`      | The diff editor; bundled into `editor/dist` by `bun run build`           |
| `editor/languages.ts` | The syntax grammars the diff editor ships; others diff as plain text     |

The icon files `src/icons/svgs.ts`, `associations.ts` and `palette.ts` are generated from
Catppuccin's repositories at pinned commits: change the pins in `scripts/vendor-icons.ts` and run
`bun run vendor-icons`, don't edit them.

Most changes are preset rules in `src/categories.ts`. Add a case to `src/classify.test.ts` for each
one.

## Before you open a pull request

```sh
bun run typecheck
bun run lint
bunx oxfmt .
orca plugin test .
orca plugin validate .
```

All five must pass. For a UI change, add a screenshot to the pull request:
`orca plugin shot local.diff-breakdown` saves one to `.orca/shots/`.

Keep a pull request to one change. Commit messages start with the area when it helps, such as
`Panel: …` or `README: …`.

## Release

Releases are Git tags. `orca plugin install` and the [plugin directory](https://orca.dev/plugins)
pick the newest `vX.Y.Z` tag.

1. Set the new `version` in `orca-plugin.json` and `package.json`.
2. Run the five checks above.
3. Commit and push: `git commit -am "Release vX.Y.Z" && git push origin main`.
4. Tag that commit and push the tag: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
5. Check https://orca.dev/plugins/adamthewilliam/orca-diff-breakdown.

The repository needs the `orca-plugin` topic for the directory to list it. It's set once:
`gh repo edit adamthewilliam/orca-diff-breakdown --add-topic orca-plugin`.

Things to know before tagging:

- Users update without being asked unless the release needs new access. A new capability, panel,
  command or event subscription, or a higher execution profile, makes every user approve again.
- Set `engines.orca` to the newest Orca release whose features you use. The directory checks the
  plugin against the latest Orca release and holds the listing if it fails.
- Listing images in `assets/` (`cover`, `screenshots` in the manifest) must be PNG, JPEG or WebP.
  The cover is at least 800×500 and at most 1 MB, each screenshot at least 1280×800 and at most
  1.5 MB, with at most 6 screenshots.
