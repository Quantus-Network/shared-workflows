import { basename } from "node:path";

import type { LockedDependency, LockfileFormat, UncheckableDependency } from "../types.js";
import { bunLockfile } from "./bun.js";
import { cargoLockfile } from "./cargo.js";
import { npmLockfile } from "./npm.js";
import { pubLockfile } from "./pub.js";

/**
 * Every supported lockfile format. Adding an ecosystem means adding one module
 * here (plus a registry, if the ecosystem does not reuse an existing one).
 */
export const LOCKFILE_FORMATS: readonly LockfileFormat[] = [
  npmLockfile,
  bunLockfile,
  pubLockfile,
  cargoLockfile,
];

/** Basenames the scanner looks for, derived from the formats above. */
export const LOCKFILE_FILENAMES: readonly string[] = LOCKFILE_FORMATS.flatMap(
  (format) => format.filenames,
);

export function formatForLockfile(lockfilePath: string): LockfileFormat {
  const filename = basename(lockfilePath);
  const format = LOCKFILE_FORMATS.find((candidate) => candidate.filenames.includes(filename));
  if (!format) {
    throw new Error(
      `No lockfile parser for "${lockfilePath}". Supported lockfiles: ${LOCKFILE_FILENAMES.join(", ")}.`,
    );
  }
  return format;
}

export interface CollectedLockfile {
  dependencies: LockedDependency[];
  uncheckable: UncheckableDependency[];
}

export function collectFromLockfile(
  lockfilePath: string,
  content: string,
): LockedDependency[] {
  return collectDetailed(lockfilePath, content).dependencies;
}

export function collectDetailed(lockfilePath: string, content: string): CollectedLockfile {
  const format = formatForLockfile(lockfilePath);
  let parsed;
  try {
    parsed = format.parse(content, lockfilePath);
  } catch (cause) {
    throw new Error(
      `Failed to parse ${format.displayName} lockfile "${lockfilePath}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
  return {
    dependencies: parsed.refs.map((ref) => ({ ...ref, lockfile: lockfilePath })),
    uncheckable: parsed.uncheckable.map((entry) => ({ ...entry, lockfile: lockfilePath })),
  };
}

export { bunLockfile, cargoLockfile, npmLockfile, pubLockfile };
