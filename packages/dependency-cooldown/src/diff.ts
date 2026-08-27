import { type LockedDependency, dependencyKey } from "./types.js";

/**
 * Returns the dependency versions present in `head` but not in `base`, keyed by
 * registry, name and version only. A version that merely moved between
 * lockfiles is therefore not treated as newly introduced, and a version
 * introduced by several lockfiles at once is reported once.
 */
export function findIntroducedDependencies(
  base: readonly LockedDependency[],
  head: readonly LockedDependency[],
): LockedDependency[] {
  const known = new Set(base.map(dependencyKey));
  const introduced = new Map<string, LockedDependency>();

  for (const dependency of head) {
    const key = dependencyKey(dependency);
    if (known.has(key) || introduced.has(key)) {
      continue;
    }
    introduced.set(key, dependency);
  }

  return [...introduced.values()];
}
