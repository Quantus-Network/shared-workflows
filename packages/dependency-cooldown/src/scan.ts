import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
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
 * Exact dummy bun.lockb committed by Quantus Cloudflare Pages checkouts (docs,
 * explorer, website). Identity is this whole buffer, not its length: a
 * different 189-byte file is a real lockfile and fails closed.
 */
export const CLOUDFLARE_PAGES_BUN_LOCKB_MARKER =
  "# THIS IS JUST DUMMY FILE FOR HELPING CLOUDFLARE DETECT BUN PACKAGE MANAGER (https://community.cloudflare.com/t/bun-not-detected-as-tool-when-using-new-bun-lock-instead-of-bun-lockb/779835)";

const CLOUDFLARE_PAGES_BUN_LOCKB_MARKER_BYTES = Buffer.from(CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);

function siblingBunLock(lockbPath: string): string {
  const directory = dirname(lockbPath);
  return directory === "." ? "bun.lock" : `${directory}/bun.lock`;
}

function isCloudflarePagesDummyBunLockb(content: Buffer): boolean {
  return content.equals(CLOUDFLARE_PAGES_BUN_LOCKB_MARKER_BYTES);
}

function isDummyBunLockbOnDisk(repoDir: string, lockbPath: string): boolean {
  return isCloudflarePagesDummyBunLockb(readFileSync(join(repoDir, lockbPath)));
}

/**
 * bun.lockb is listed so a binary-only repository fails closed. A sibling
 * bun.lock is the inspectable source of truth only when bun.lockb is the
 * known Cloudflare Pages dummy; a real or unknown paired bun.lockb is kept
 * so the parser rejects it instead of skipping an unreadable lockfile.
 */
function omitDummyBunLockbCoveredByTextLock(
  lockfiles: string[],
  dummyLockbPaths: ReadonlySet<string>,
): string[] {
  const present = new Set(lockfiles);
  return lockfiles.filter((path) => {
    if (basename(path) !== "bun.lockb") {
      return true;
    }
    if (!present.has(siblingBunLock(path))) {
      return true;
    }
    return !dummyLockbPaths.has(path);
  });
}

function dummyBunLockbPathsOnDisk(repoDir: string, lockfiles: string[]): Set<string> {
  const present = new Set(lockfiles);
  const dummies = new Set<string>();
  for (const path of lockfiles) {
    if (basename(path) !== "bun.lockb" || !present.has(siblingBunLock(path))) {
      continue;
    }
    if (isDummyBunLockbOnDisk(repoDir, path)) {
      dummies.add(path);
    }
  }
  return dummies;
}

export function discoverLockfiles(repoDir: string): string[] {
  const lockfiles = globSync(
    LOCKFILE_FILENAMES.map((filename) => `**/${filename}`),
    {
      cwd: repoDir,
      ignore: IGNORED_DIRECTORY_NAMES.map((name) => `**/${name}/**`),
      // Lockfiles under dot-directories still count; only the names above are
      // skipped.
      dot: true,
      onlyFiles: true,
    },
  ).sort();
  return omitDummyBunLockbCoveredByTextLock(lockfiles, dummyBunLockbPathsOnDisk(repoDir, lockfiles));
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

async function isDummyBunLockbAtRef(
  repoDir: string,
  ref: string,
  lockbPath: string,
): Promise<boolean> {
  const { stdout } = await run("git", ["cat-file", "blob", `${ref}:${lockbPath}`], {
    cwd: repoDir,
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!Buffer.isBuffer(stdout)) {
    throw new Error(`git cat-file blob ${ref}:${lockbPath} did not return a buffer`);
  }
  return isCloudflarePagesDummyBunLockb(stdout);
}

async function dummyBunLockbPathsAtRef(
  repoDir: string,
  ref: string,
  lockfiles: string[],
): Promise<Set<string>> {
  const present = new Set(lockfiles);
  const dummies = new Set<string>();
  for (const path of lockfiles) {
    if (basename(path) !== "bun.lockb" || !present.has(siblingBunLock(path))) {
      continue;
    }
    if (await isDummyBunLockbAtRef(repoDir, ref, path)) {
      dummies.add(path);
    }
  }
  return dummies;
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
  const lockfiles = stdout
    .split("\n")
    .filter((path) => path.length > 0)
    .filter((path) => LOCKFILE_FILENAMES.includes(path.split("/").pop() as string))
    .filter((path) => !isIgnoredPath(path))
    .sort();
  return omitDummyBunLockbCoveredByTextLock(
    lockfiles,
    await dummyBunLockbPathsAtRef(repoDir, ref, lockfiles),
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
