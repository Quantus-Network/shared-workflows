# Dependency cooldown

## The policy

Every dependency version that a pull request introduces must have been published
at least **30 days** ago.

Most package-registry supply-chain attacks are found and pulled within days of
publication. Refusing to adopt brand-new versions means the organisation is
never the one that discovers a compromised release.

The rule applies to:

- **Direct and transitive dependencies alike.** The check reads lockfiles, not
  manifests, because transitive dependencies are the more common attack vector.
- **Every supported ecosystem in the repository.** A repository with both
  `package-lock.json` and `Cargo.lock` has both checked in one job.

The rule does *not* apply to dependencies that were already locked before the
pull request. Only versions that the pull request adds are checked, so an
existing violation never blocks unrelated work. Use the scheduled audit to see
what is already in place.

## What counts as "introduced"

A dependency is checked when the tuple *(registry, name, version)* appears in
the head lockfiles but not in the base lockfiles. Consequences worth knowing:

- Removing a dependency is never a violation.
- Moving a lockfile does not re-check its contents; the base tree is enumerated
  by name, so a rename is not mistaken for thousands of new dependencies.
- Adding a new lockfile checks all of its dependencies, because none of them
  were previously vetted in this repository.
- Downgrading is checked, but an older version passes trivially.

## Adopting it in a repository

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

The `labeled`, `unlabeled` and `edited` event types are required. They are what
re-runs the gate after someone applies the bypass label or edits the pull
request description to add the reason.

Finally, mark **Dependency cooldown** as a required status check in the branch
protection or ruleset for the default branch. Without that, the workflow reports
but does not actually gate anything.

The scheduled audit is a separate, optional workflow:

```yaml
# .github/workflows/dependency-cooldown-audit.yml
name: Dependency cooldown audit

on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    uses: Quantus-Network/shared-workflows/.github/workflows/dependency-cooldown-audit.yml@v1
```

## Raising the cooldown for one repository

A repository holding especially sensitive code can demand a longer wait:

```yaml
# .github/dependency-cooldown.yml
minReleaseAgeDays: 90
```

A value **below** the organisation floor of 30 days is rejected outright — the
run fails with a configuration error rather than quietly using 30. That keeps
the floor from being weakened by a pull request to a repository's own config.
Unknown keys are also rejected, so a typo cannot silently disable the setting.

## Emergency bypass

Sometimes a fix cannot wait: an actively exploited CVE, a leaked credential to
rotate, a production outage.

1. Apply the **`dependency-cooldown-bypass`** label to the pull request.
2. Add a line to the pull request description explaining why:

   ```
   Cooldown-bypass-reason: CVE-2026-1234 allows unauthenticated RCE in the API
   ```

3. Re-running is automatic if the workflow listens for `labeled` and `edited`.

The check then passes, and the summary records the bypass and its reason so it
is visible in the merge history.

The reason is mandatory and must be at least 20 characters. A label with no
reason fails the run rather than passing quietly — an unexplained bypass is
worse than a blocked pull request.

### What the bypass deliberately does not do

The check reads the label from the webhook payload, so it needs no token and
works on pull requests from forks. The trade-off is that it cannot verify *who*
applied the label. Treat the label as an audit trail, not an authorisation
boundary, and restrict who may apply it using GitHub's label and ruleset
controls if that matters.

## Dependencies that cannot be checked

Git, path and workspace dependencies have no registry publish date, so no age
can be established. They are listed in the job summary under "could not be
age-checked" instead of being silently ignored — a dependency the tool skipped
without saying so would be a hole in the policy. Review those by hand.

Bun's binary `bun.lockb` cannot be inspected. A repository that only has
`bun.lockb` fails the run. A sibling `bun.lockb` is ignored only when its
bytes are identical to the Cloudflare Pages dummy used by Quantus checkouts
(`# THIS IS JUST DUMMY FILE...`). Length is not enough: a different file of
the same size is rejected. Package changes are still taken from `bun.lock`;
the dummy cannot encode a graph. A real or unknown `bun.lockb` next to
`bun.lock` is rejected, because the two files can diverge (Bun 1.1 still
installs from the binary). Bun's own migration is to generate `bun.lock` and
then delete `bun.lockb`. Commit the text lockfile with:

```bash
bun install --save-text-lockfile
```

## Supported ecosystems

| Lockfile | Registry consulted |
| --- | --- |
| `package-lock.json`, `npm-shrinkwrap.json` | registry.npmjs.org |
| `bun.lock` | registry.npmjs.org |
| `pubspec.lock` | pub.dev |
| `Cargo.lock` | crates.io |

Lockfiles under `node_modules/`, `target/`, `.dart_tool/` and `.git/` are
ignored, since those hold installed or generated copies of other projects'
lockfiles. That list is deliberately short: every name on it is a place the
policy stops looking, so generic names such as `build` are *not* ignored. Every
lockfile the job did consider is printed at the top of its log.

## Adding an ecosystem

The design goal is that a new language costs one file plus one fixture.

1. **Add the lockfile parser** in
   `packages/dependency-cooldown/src/lockfiles/<name>.ts`, exporting a
   `LockfileFormat`. `parse` returns the registry-resolved versions it found
   *and* the entries it could not attribute to a registry. Never drop an entry
   silently: put it in `uncheckable` with a reason.
2. **Add a registry client** in `src/registries/<name>.ts` if the ecosystem uses
   a registry that is not already supported, exporting a `Registry` that maps a
   name and version to a publish date. Set `maxConcurrency` and
   `minRequestIntervalMs` to whatever the registry's rate limit tolerates
   (crates.io: one request per second). Register it in `src/registries/index.ts` and
   add the id to `RegistryId` in `src/types.ts`.
3. **Register the format** in the `LOCKFILE_FORMATS` array in
   `src/lockfiles/index.ts`. Lockfile discovery, diffing, reporting and the
   workflows all derive from that array and need no change.
4. **Add fixtures and tests.** Commit a realistic `base` and `head` lockfile
   under `test/fixtures/<name>/`, and cover at minimum: registry versions are
   collected, git/path/workspace entries land in `uncheckable`, and the registry
   client extracts the publish date of the exact version.
5. **Rebuild and commit the bundle:** `npm run build`.

Design rules to keep in mind when writing an adapter:

- A lookup failure must reject, never default. If a publish date cannot be
  established the run fails; a dependency that could not be verified must never
  be reported as compliant.
- Do not retry on registry errors. A registry outage should show up as a red
  check, not as a delay that eventually lets something through.

## Why not just configure Renovate?

Renovate's `minimumReleaseAge` is a good complement and worth enabling if the
organisation adopts Renovate, but it only constrains pull requests Renovate
itself opens. This check constrains every pull request, whoever opens it,
including a hand-edited lockfile, and it covers transitive versions that a bot
config would not see.
