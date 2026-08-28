import { describe, expect, it } from "vitest";

import type { HttpClient } from "../src/registries/http.js";
import { type Clock, resolvePublishDates } from "../src/resolve.js";
import type { LockedDependency } from "../src/types.js";

const PUBLISHED = "2026-01-15T00:00:00.000Z";

/** Admits every request immediately so tests can assert concurrency, not wall-clock pacing. */
const unpaced: Clock = {
  now: () => Date.now(),
  sleep: async () => {},
};

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

  it("never overlaps crates.io requests", async () => {
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
      unpaced,
    );

    expect(peak).toBe(1);
  });

  it("starts crates.io requests at most once per second", async () => {
    let now = 0;
    const starts: number[] = [];
    const http: HttpClient = {
      async getJson() {
        starts.push(now);
        now += 5;
        return { version: { num: "1.0.0", created_at: PUBLISHED } };
      },
    };

    await resolvePublishDates(["a", "b"].map((name) => dep("cargo", name)), http, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(starts).toEqual([0, 1000]);
  });

  it("waits in real time between crates.io request starts", async () => {
    const starts: number[] = [];
    const http: HttpClient = {
      async getJson() {
        starts.push(Date.now());
        return { version: { num: "1.0.0", created_at: PUBLISHED } };
      },
    };

    await resolvePublishDates(["a", "b"].map((name) => dep("cargo", name)), http);

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(950);
  });

  it("does not idle after a crates.io lookup that already took a second", async () => {
    let now = 0;
    const starts: number[] = [];
    const sleeps: number[] = [];
    const http: HttpClient = {
      async getJson() {
        starts.push(now);
        now += 1500;
        return { version: { num: "1.0.0", created_at: PUBLISHED } };
      },
    };

    await resolvePublishDates(["a", "b"].map((name) => dep("cargo", name)), http, {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    expect(starts).toEqual([0, 1500]);
    expect(sleeps).toEqual([]);
  });

  it("does not apply crates.io spacing to other registries", async () => {
    const starts: number[] = [];
    const http: HttpClient = {
      async getJson() {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { time: { "1.0.0": PUBLISHED } };
      },
    };

    await resolvePublishDates(["a", "b"].map((name) => dep("npm", name)), http);

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeLessThan(1000);
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
