import type { Registry } from "../types.js";
import { parseTimestamp } from "./timestamp.js";

interface PubVersion {
  version?: unknown;
  published?: unknown;
}

export const pubRegistry: Registry = {
  id: "pub",
  displayName: "pub.dev",
  maxConcurrency: 8,
  minRequestIntervalMs: 0,

  versionUrl(name, version) {
    return `https://pub.dev/packages/${name}/versions/${version}`;
  },

  async fetchPublishedAt(name, version, http) {
    const url = `https://pub.dev/api/packages/${encodeURIComponent(name)}`;
    const payload = (await http.getJson(url)) as { versions?: PubVersion[] };
    if (!Array.isArray(payload?.versions)) {
      throw new Error(`pub.dev returned no version list for ${name}.`);
    }
    const match = payload.versions.find((entry) => entry.version === version);
    if (!match || typeof match.published !== "string") {
      throw new Error(`pub.dev has no publish time for ${name}@${version}.`);
    }
    return parseTimestamp(match.published, `${name}@${version}`);
  },
};
