import { describe, expect, it } from "vitest";

import { cargoRegistry } from "../src/registries/cargo.js";
import { npmRegistry } from "../src/registries/npm.js";
import { pubRegistry } from "../src/registries/pub.js";
import type { HttpClient } from "../src/registries/http.js";

function stubHttp(payloads: Record<string, unknown>): HttpClient {
  return {
    async getJson(url: string): Promise<unknown> {
      if (!(url in payloads)) {
        throw new Error(`unexpected request: ${url}`);
      }
      return payloads[url];
    },
  };
}

describe("registry request pacing", () => {
  it("only crates.io asks for a one-second gap between request starts", () => {
    expect(npmRegistry.minRequestIntervalMs).toBe(0);
    expect(pubRegistry.minRequestIntervalMs).toBe(0);
    expect(cargoRegistry.minRequestIntervalMs).toBe(1000);
  });
});

describe("npm registry", () => {
  const packument = {
    "https://registry.npmjs.org/left-pad": {
      time: {
        created: "2014-03-13T00:00:00.000Z",
        "1.3.0": "2018-03-16T17:33:14.892Z",
      },
    },
  };

  it("reads the publish date of the exact version", async () => {
    const publishedAt = await npmRegistry.fetchPublishedAt(
      "left-pad",
      "1.3.0",
      stubHttp(packument),
    );

    expect(publishedAt.toISOString()).toBe("2018-03-16T17:33:14.892Z");
  });

  it("fails when the version is missing from the packument", async () => {
    await expect(
      npmRegistry.fetchPublishedAt("left-pad", "9.9.9", stubHttp(packument)),
    ).rejects.toThrow(/left-pad@9\.9\.9/);
  });

  it("url-encodes scoped package names", async () => {
    const publishedAt = await npmRegistry.fetchPublishedAt(
      "@scope/util",
      "2.2.0",
      stubHttp({
        "https://registry.npmjs.org/@scope%2futil": {
          time: { "2.2.0": "2026-01-02T03:04:05.000Z" },
        },
      }),
    );

    expect(publishedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("pub registry", () => {
  it("reads the publish date of the exact version", async () => {
    const publishedAt = await pubRegistry.fetchPublishedAt(
      "http",
      "1.3.0",
      stubHttp({
        "https://pub.dev/api/packages/http": {
          versions: [
            { version: "1.2.2", published: "2024-07-01T10:00:00.000Z" },
            { version: "1.3.0", published: "2025-02-11T09:30:00.000Z" },
          ],
        },
      }),
    );

    expect(publishedAt.toISOString()).toBe("2025-02-11T09:30:00.000Z");
  });
});

describe("cargo registry", () => {
  it("reads the publish date of the exact version", async () => {
    const publishedAt = await cargoRegistry.fetchPublishedAt(
      "serde",
      "1.0.213",
      stubHttp({
        "https://crates.io/api/v1/crates/serde/1.0.213": {
          version: { num: "1.0.213", created_at: "2024-10-24T14:12:00.000Z" },
        },
      }),
    );

    expect(publishedAt.toISOString()).toBe("2024-10-24T14:12:00.000Z");
  });

  it("fails when the payload carries a different version", async () => {
    await expect(
      cargoRegistry.fetchPublishedAt(
        "serde",
        "1.0.213",
        stubHttp({
          "https://crates.io/api/v1/crates/serde/1.0.213": {
            version: { num: "1.0.214", created_at: "2024-10-24T14:12:00.000Z" },
          },
        }),
      ),
    ).rejects.toThrow(/1\.0\.214/);
  });
});
