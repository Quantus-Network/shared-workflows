import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

import type { DependencyRef, LockfileFormat, ParsedLockfile } from "../types.js";

/**
 * Bun's text lockfile records every resolved package as
 * `"<key>": ["<name>@<version>", registry, meta, integrity]`. Non-registry
 * dependencies use a descriptor such as `name@workspace:path` or
 * `name@git+https://...` instead of a semver version.
 *
 * Local tarballs are a separate resolution type: Bun writes `name@./file.tgz`
 * with no `file:` prefix (folders use `file:`, remote tarball URLs use
 * `http:`/`https:`). Distinguishing them from registry versions must use the
 * tuple, not the specifier suffix: npm prereleases such as `1.2.3-release.tgz`
 * are valid, and Bun still stores them as `[name@version, registry, meta,
 * integrity]` with a string registry field. Local tarballs put the metadata
 * object in that slot: `[name@tarball, meta]`.
 */
const NON_REGISTRY_PROTOCOLS = [
  "workspace:",
  "link:",
  "file:",
  "git+",
  "github:",
  "http:",
  "https:",
  "root:",
];

const LOCAL_TARBALL_EXTENSIONS = [".tgz", ".tar.gz", ".tar"];

function isLocalTarballSpecifier(specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return true;
  }
  return LOCAL_TARBALL_EXTENSIONS.some((extension) => specifier.endsWith(extension));
}

/** npm resolutions store a registry URL (or `""` for the default) at index 1. */
function isNpmRegistryTuple(entry: unknown[]): boolean {
  return typeof entry[1] === "string";
}

function splitDescriptor(descriptor: string): { name: string; specifier: string } {
  // The separator is the first @ after index 0: a scoped name starts with @,
  // and a git specifier may itself contain one (git+ssh://git@host/...).
  const separator = descriptor.indexOf("@", 1);
  if (separator <= 0) {
    throw new Error(`Cannot read package name and version from bun descriptor "${descriptor}".`);
  }
  return {
    name: descriptor.slice(0, separator),
    specifier: descriptor.slice(separator + 1),
  };
}

export const bunLockfile: LockfileFormat = {
  id: "bun",
  displayName: "Bun",
  filenames: ["bun.lock", "bun.lockb"],
  registry: "npm",

  parse(content, lockfilePath): ParsedLockfile {
    if (lockfilePath.endsWith("bun.lockb")) {
      throw new Error(
        `${lockfilePath} is Bun's binary lockfile, which cannot be inspected. Run "bun install --save-text-lockfile" to commit a bun.lock text lockfile instead (Bun 1.2+).`,
      );
    }

    const errors: ParseError[] = [];
    const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as {
      packages?: Record<string, unknown>;
    };
    if (errors.length > 0) {
      const first = errors[0] as ParseError;
      throw new Error(
        `${lockfilePath} is not valid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}.`,
      );
    }
    if (!parsed?.packages || typeof parsed.packages !== "object") {
      throw new Error(`${lockfilePath} has no "packages" object; it is not a supported bun.lock.`);
    }

    const refs: DependencyRef[] = [];
    const uncheckable: ParsedLockfile["uncheckable"] = [];

    for (const [key, entry] of Object.entries(parsed.packages)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") {
        throw new Error(`${lockfilePath} entry "${key}" is not a bun package tuple.`);
      }
      const { name, specifier } = splitDescriptor(entry[0]);
      const protocol = NON_REGISTRY_PROTOCOLS.find((candidate) =>
        specifier.startsWith(candidate),
      );
      if (protocol !== undefined) {
        uncheckable.push({ name, version: null, reason: `resolved via ${protocol}` });
        continue;
      }
      if (!isNpmRegistryTuple(entry) && isLocalTarballSpecifier(specifier)) {
        uncheckable.push({ name, version: null, reason: "resolved via local tarball" });
        continue;
      }
      refs.push({ registry: "npm", name, version: specifier });
    }

    return { refs, uncheckable };
  },
};
