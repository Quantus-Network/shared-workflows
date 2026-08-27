import { parse as parseToml } from "smol-toml";

import type { DependencyRef, LockfileFormat, ParsedLockfile } from "../types.js";

interface CargoPackage {
  name?: unknown;
  version?: unknown;
  source?: unknown;
}

const CRATES_IO_SOURCES = [
  "registry+https://github.com/rust-lang/crates.io-index",
  "sparse+https://index.crates.io/",
];

export const cargoLockfile: LockfileFormat = {
  id: "cargo",
  displayName: "Rust / Cargo",
  filenames: ["Cargo.lock"],
  registry: "cargo",

  parse(content, lockfilePath): ParsedLockfile {
    const parsed = parseToml(content) as { package?: unknown };
    if (!Array.isArray(parsed.package)) {
      throw new Error(
        `${lockfilePath} has no [[package]] entries; it is not a supported Cargo.lock.`,
      );
    }

    const refs: DependencyRef[] = [];
    const uncheckable: ParsedLockfile["uncheckable"] = [];

    for (const entry of parsed.package as CargoPackage[]) {
      if (typeof entry.name !== "string") {
        throw new Error(`${lockfilePath} contains a [[package]] entry without a name.`);
      }
      const version = typeof entry.version === "string" ? entry.version : null;

      // Workspace members and path dependencies carry no source at all; those
      // are first-party code and out of scope for a registry cooldown.
      if (entry.source === undefined) {
        continue;
      }
      if (typeof entry.source !== "string" || !CRATES_IO_SOURCES.includes(entry.source)) {
        uncheckable.push({
          name: entry.name,
          version,
          reason: `source is ${String(entry.source)}, not crates.io`,
        });
        continue;
      }
      if (version === null) {
        throw new Error(`${lockfilePath} package "${entry.name}" has no version.`);
      }
      refs.push({ registry: "cargo", name: entry.name, version });
    }

    return { refs, uncheckable };
  },
};
