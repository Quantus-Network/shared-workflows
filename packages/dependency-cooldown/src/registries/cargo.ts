import type { Registry } from "../types.js";
import { parseTimestamp } from "./timestamp.js";

export const cargoRegistry: Registry = {
  id: "cargo",
  displayName: "crates.io",
  // crates.io data-access policy: at most one API request per second.
  maxConcurrency: 1,
  minRequestIntervalMs: 1000,

  versionUrl(name, version) {
    return `https://crates.io/crates/${name}/${version}`;
  },

  async fetchPublishedAt(name, version, http) {
    const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
    const payload = (await http.getJson(url)) as {
      version?: { num?: unknown; created_at?: unknown };
    };
    const detail = payload?.version;
    if (!detail || typeof detail.created_at !== "string") {
      throw new Error(`crates.io has no publish time for ${name}@${version}.`);
    }
    if (detail.num !== version) {
      throw new Error(
        `crates.io returned ${name}@${String(detail.num)} when asked for ${name}@${version}.`,
      );
    }
    return parseTimestamp(detail.created_at, `${name}@${version}`);
  },
};
