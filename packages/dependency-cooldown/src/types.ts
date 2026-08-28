import type { HttpClient } from "./registries/http.js";

/** Package registry a dependency was resolved from. */
export type RegistryId = "npm" | "pub" | "cargo";

export interface DependencyRef {
  registry: RegistryId;
  name: string;
  version: string;
}

export interface LockedDependency extends DependencyRef {
  /** Repository-relative path of the lockfile the dependency was found in. */
  lockfile: string;
}

/**
 * A lockfile entry whose age cannot be established, because it does not come
 * from a supported package registry (git, path and workspace dependencies).
 * These are surfaced in the report instead of being dropped silently.
 */
export interface UncheckableDependency {
  name: string;
  version: string | null;
  reason: string;
  lockfile: string;
}

export interface ParsedLockfile {
  refs: DependencyRef[];
  uncheckable: Omit<UncheckableDependency, "lockfile">[];
}

export interface LockfileFormat {
  id: string;
  displayName: string;
  /** Basenames this format claims. Matched case-sensitively against the file name. */
  filenames: string[];
  registry: RegistryId;
  parse(content: string, lockfilePath: string): ParsedLockfile;
}

export interface Registry {
  id: RegistryId;
  displayName: string;
  /**
   * Parallel in-flight requests allowed against this registry.
   */
  maxConcurrency: number;
  /**
   * Minimum milliseconds between starting requests to this registry.
   * crates.io allows at most one API request per second, so cargo uses 1000.
   * Registries with no documented request-rate cap use 0.
   */
  minRequestIntervalMs: number;
  /** Human-facing page for a version, used in the report. */
  versionUrl(name: string, version: string): string;
  fetchPublishedAt(name: string, version: string, http: HttpClient): Promise<Date>;
}

export function dependencyKey(ref: DependencyRef): string {
  return `${ref.registry}:${ref.name}@${ref.version}`;
}
