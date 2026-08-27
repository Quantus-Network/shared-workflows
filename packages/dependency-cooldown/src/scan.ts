import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { globSync } from "tinyglobby";

import { LOCKFILE_FILENAMES, collectDetailed } from "./lockfiles/index.js";
import type { LockedDependency, UncheckableDependency } from "./types.js";

const run = promisify(execFile);

/**
 * Tool-generated directories, which only ever hold installed or vendored copies
 * of other projects' lockfiles rather than this repository's own state.
 *
 * Kept deliberately short. Every name here is a place the policy stops looking,
 * so a generic name such as `build` is excluded from the list: a real package
 * could legitimately live in a directory called that, and skipping it silently
 * would be a hole in the policy.
 */
export const IGNORED_DIRECTORY_NAMES = [".git", "node_modules", "target", ".dart_tool"];

/**
 * bun.lockb is listed so a binary-only repository fails closed. When a text
 * bun.lock sits in the same directory (Bun 1.2+ plus a Cloudflare Pages marker
 * file, for example), the text lockfile is the inspectable source of truth.
 */
function omitBunLockbCoveredByTextLock(lockfiles: string[]): string[] {
  const present = new Set(lockfiles);
  return lockfiles.filter((path) => {
    if (basename(path) !== "bun.lockb") {
      return true;
    }
    const directory = dirname(path);
    const textLock = directory === "." ? "bun.lock" : `${directory}/bun.lock`;
    return !present.has(textLock);
  });
}

export function discoverLockfiles(repoDir: string): string[] {
  return omitBunLockbCoveredByTextLock(
    globSync(
      LOCKFILE_FILENAMES.map((filename) => `**/${filename}`),
      {
        cwd: repoDir,
        ignore: IGNORED_DIRECTORY_NAMES.map((name) => `**/${name}/**`),
        // Lockfiles under dot-directories still count; only the names above are
        // skipped.
        dot: true,
        onlyFiles: true,
      },
    ).sort(),
  );
}

export interface ScanResult {
  dependencies: LockedDependency[];
  uncheckable: UncheckableDependency[];
}

export async function scanWorkingTree(repoDir: string, lockfiles: string[]): Promise<ScanResult> {
  const result: ScanResult = { dependencies: [], uncheckable: [] };
  for (const lockfile of lockfiles) {
    const content = await readFile(join(repoDir, lockfile), "utf8");
    const collected = collectDetailed(lockfile, content);
    result.dependencies.push(...collected.dependencies);
    result.uncheckable.push(...collected.uncheckable);
  }
  return result;
}

function isIgnoredPath(path: string): boolean {
  return path.split("/").some((segment) => IGNORED_DIRECTORY_NAMES.includes(segment));
}

/**
 * Lists lockfiles as they existed at `ref`, so that moving or renaming a
 * lockfile does not make its whole content look newly introduced.
 */
export async function listLockfilesAtRef(repoDir: string, ref: string): Promise<string[]> {
  const { stdout } = await run("git", ["ls-tree", "-r", "--name-only", ref], {
    cwd: repoDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  return omitBunLockbCoveredByTextLock(
    stdout
      .split("\n")
      .filter((path) => path.length > 0)
      .filter((path) => LOCKFILE_FILENAMES.includes(path.split("/").pop() as string))
      .filter((path) => !isIgnoredPath(path))
      .sort(),
  );
}

async function readFileAtRef(
  repoDir: string,
  ref: string,
  lockfile: string,
): Promise<string | null> {
  try {
    await run("git", ["cat-file", "-e", `${ref}:${lockfile}`], { cwd: repoDir });
  } catch {
    // The lockfile did not exist at the base revision, so every dependency in
    // the head version of it is newly introduced.
    return null;
  }
  const { stdout } = await run("git", ["show", `${ref}:${lockfile}`], {
    cwd: repoDir,
    maxBuffer: 128 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Reads the same set of lockfiles as they existed at `ref`. Files missing at
 * `ref` contribute nothing; a lockfile present at `ref` that fails to parse is
 * a hard error, because we would otherwise treat its whole content as new.
 */
export async function scanRef(
  repoDir: string,
  ref: string,
  lockfiles: string[],
): Promise<ScanResult> {
  const result: ScanResult = { dependencies: [], uncheckable: [] };
  for (const lockfile of lockfiles) {
    const content = await readFileAtRef(repoDir, ref, lockfile);
    if (content === null) {
      continue;
    }
    result.dependencies.push(...collectDetailed(lockfile, content).dependencies);
  }
  return result;
}
