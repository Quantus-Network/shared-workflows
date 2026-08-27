# shared-workflows

Reusable GitHub Actions workflows for the Quantus organisation.

## Available workflows

| Workflow | Purpose |
| --- | --- |
| [`dependency-cooldown.yml`](.github/workflows/dependency-cooldown.yml) | Blocking pull request gate: no dependency version younger than 30 days may enter a repository. |
| [`dependency-cooldown-audit.yml`](.github/workflows/dependency-cooldown-audit.yml) | Non-blocking scheduled report of locked dependency versions still inside the cooldown window. |

## Quick start

Add this to any repository that has a lockfile:

```yaml
# .github/workflows/dependency-cooldown.yml
name: Dependency cooldown

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled, edited]

permissions:
  contents: read

jobs:
  dependency-cooldown:
    uses: Quantus-Network/shared-workflows/.github/workflows/dependency-cooldown.yml@v1
```

Then make **Dependency cooldown** a required status check on the default branch.

Full documentation, including the emergency bypass procedure and how to add a
new language ecosystem, lives in
[docs/dependency-cooldown.md](docs/dependency-cooldown.md).

## Repository layout

```
.github/workflows/     reusable workflows callers reference, plus this repo's own CI
actions/               composite actions, each shipping a committed dist/ bundle
packages/              TypeScript sources for those bundles, with their tests
docs/                  adoption and maintenance guides
examples/              copy-paste caller configuration
```

## Developing

```bash
cd packages/dependency-cooldown
npm ci
npm test
npm run typecheck
npm run build   # refreshes actions/dependency-cooldown/dist/index.mjs
```

`dist/` is committed so consuming repositories need no install step. CI fails if
it is out of date with `src/`, so always commit the rebuilt bundle.

## Releasing

Callers pin these workflows to a moving major tag, so **nothing works until the
`v1` tag exists**. After merging to `main`:

```bash
git tag -f v1 && git push -f origin v1
```

Two things must move together, because a reusable workflow resolves the action
it calls by ref, not relative path:

- the reusable workflows in `.github/workflows/`, and
- the `uses: Quantus-Network/shared-workflows/actions/...@v1` line inside them.

For a breaking policy change, add a `v2` tag and update those `uses:` lines to
`@v2` in the same commit, leaving `v1` callers untouched.
