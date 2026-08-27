import { parse as parseYaml } from "yaml";

import type { DependencyRef, LockfileFormat, ParsedLockfile } from "../types.js";

interface PubEntry {
  source?: unknown;
  version?: unknown;
  description?: { name?: unknown; url?: unknown } | unknown;
}

const PUB_DEV = "https://pub.dev";

export const pubLockfile: LockfileFormat = {
  id: "pub",
  displayName: "Dart / pub",
  filenames: ["pubspec.lock"],
  registry: "pub",

  parse(content, lockfilePath): ParsedLockfile {
    const parsed = parseYaml(content) as { packages?: Record<string, PubEntry> } | null;
    if (!parsed?.packages || typeof parsed.packages !== "object") {
      throw new Error(
        `${lockfilePath} has no "packages" mapping; it is not a supported pubspec.lock.`,
      );
    }

    const refs: DependencyRef[] = [];
    const uncheckable: ParsedLockfile["uncheckable"] = [];

    for (const [key, entry] of Object.entries(parsed.packages)) {
      const version = typeof entry.version === "string" ? entry.version : null;
      if (entry.source !== "hosted") {
        uncheckable.push({
          name: key,
          version,
          reason: `source is "${String(entry.source)}", not hosted`,
        });
        continue;
      }
      const description = entry.description as { name?: unknown; url?: unknown } | undefined;
      const url = typeof description?.url === "string" ? description.url : null;
      if (url !== PUB_DEV) {
        uncheckable.push({ name: key, version, reason: `hosted on ${String(url)}, not pub.dev` });
        continue;
      }
      if (version === null) {
        throw new Error(`${lockfilePath} package "${key}" has no version.`);
      }
      const name = typeof description?.name === "string" ? description.name : key;
      refs.push({ registry: "pub", name, version });
    }

    return { refs, uncheckable };
  },
};
