import type { Registry } from "../types.js";
import { parseTimestamp } from "./timestamp.js";

/** Scoped names must keep the leading @ but escape the separating slash. */
function encodeName(name: string): string {
  return name.startsWith("@")
    ? `@${encodeURIComponent(name.slice(1)).replace("%2F", "%2f")}`
    : encodeURIComponent(name);
}

export const npmRegistry: Registry = {
  id: "npm",
  displayName: "npmjs.com",
  maxConcurrency: 8,
  minRequestIntervalMs: 0,

  versionUrl(name, version) {
    return `https://www.npmjs.com/package/${name}/v/${version}`;
  },

  async fetchPublishedAt(name, version, http) {
    // Only the full packument carries the `time` map; the abbreviated
    // metadata document omits publish timestamps.
    const url = `https://registry.npmjs.org/${encodeName(name)}`;
    const packument = (await http.getJson(url)) as { time?: Record<string, unknown> };
    const raw = packument?.time?.[version];
    if (typeof raw !== "string") {
      throw new Error(`npmjs.com has no publish time for ${name}@${version}.`);
    }
    return parseTimestamp(raw, `${name}@${version}`);
  },
};
