import type { DependencyRef, LockfileFormat, ParsedLockfile } from "../types.js";

interface NpmLockEntry {
  name?: unknown;
  version?: unknown;
  resolved?: unknown;
  link?: unknown;
}

const REGISTRY_PREFIX = "https://registry.npmjs.org/";
const NODE_MODULES = "node_modules/";

/**
 * Derives the package name from an entry path such as
 * `node_modules/a/node_modules/@scope/b` -> `@scope/b`.
 */
function nameFromPath(entryPath: string): string {
  const index = entryPath.lastIndexOf(NODE_MODULES);
  return entryPath.slice(index + NODE_MODULES.length);
}

export const npmLockfile: LockfileFormat = {
  id: "npm",
  displayName: "npm",
  filenames: ["package-lock.json", "npm-shrinkwrap.json"],
  registry: "npm",

  parse(content, lockfilePath): ParsedLockfile {
    const parsed = JSON.parse(content) as {
      lockfileVersion?: unknown;
      packages?: Record<string, NpmLockEntry>;
    };

    if (parsed.lockfileVersion === 1) {
      throw new Error(
        `${lockfilePath} uses lockfileVersion 1, which does not record resolved registry URLs. Regenerate it with npm 7 or newer.`,
      );
    }
    if (!parsed.packages || typeof parsed.packages !== "object") {
      throw new Error(
        `${lockfilePath} has no "packages" object; it is not a supported npm lockfile.`,
      );
    }

    const refs: DependencyRef[] = [];
    const uncheckable: ParsedLockfile["uncheckable"] = [];

    for (const [entryPath, entry] of Object.entries(parsed.packages)) {
      // The root project and workspace members live at paths outside
      // node_modules; symlinked workspaces are marked with `link: true`.
      if (!entryPath.includes(NODE_MODULES) || entry.link === true) {
        continue;
      }
      const name = typeof entry.name === "string" ? entry.name : nameFromPath(entryPath);
      const version = typeof entry.version === "string" ? entry.version : null;
      const resolved = entry.resolved;

      if (typeof resolved !== "string" || !resolved.startsWith(REGISTRY_PREFIX)) {
        uncheckable.push({
          name,
          version,
          reason:
            typeof resolved === "string"
              ? `not resolved from registry.npmjs.org (${resolved})`
              : "no resolved URL recorded",
        });
        continue;
      }
      if (version === null) {
        throw new Error(`${lockfilePath} entry "${entryPath}" has no version.`);
      }
      refs.push({ registry: "npm", name, version });
    }

    return { refs, uncheckable };
  },
};
