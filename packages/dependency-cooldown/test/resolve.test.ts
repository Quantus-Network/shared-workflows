import { describe, expect, it } from "vitest";

import type { HttpClient } from "../src/registries/http.js";
import { resolvePublishDates } from "../src/resolve.js";
import type { LockedDependency } from "../src/types.js";

const PUBLISHED = "2026-01-15T00:00:00.000Z";

function dep(registry: LockedDependency["registry"], name: string): LockedDependency {
  return { registry, name, version: "1.0.0", lockfile: "lock" };
}

describe("resolvePublishDates", () => {
  it("resolves dependencies across several registries", async () => {
    const http: HttpClient = {
      async getJson(url) {
        if (url.includes("registry.npmjs.org")) {
          return { time: { "1.0.0": PUBLISHED } };
        }
        if (url.includes("pub.dev")) {
          return { versions: [{ version: "1.0.0", published: PUBLISHED }] };
        }
        return { version: { num: "1.0.0", created_at: PUBLISHED } };
      },
    };

    const dated = await resolvePublishDates(
      [dep("npm", "left-pad"), dep("pub", "http"), dep("cargo", "serde")],
      http,
    );

    expect(dated).toHaveLength(3);
    expect(new Set(dated.map((entry) => entry.publishedAt.toISOString()))).toEqual(
      new Set([PUBLISHED]),
    );
  });

  it("serialises crates.io requests to respect its rate limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const http: HttpClient = {
      async getJson() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { version: { num: "1.0.0", created_at: PUBLISHED } };
      },
    };

    await resolvePublishDates(
      ["a", "b", "c", "d"].map((name) => dep("cargo", name)),
      http,
    );

    expect(peak).toBe(1);
  });

  it("rejects when a publish date cannot be established", async () => {
    const http: HttpClient = {
      async getJson() {
        throw new Error("HTTP 503 Service Unavailable");
      },
    };

    await expect(resolvePublishDates([dep("npm", "left-pad")], http)).rejects.toThrow(/503/);
  });
});
