import { describe, expect, it } from "vitest";

import { bunLockfile } from "../src/lockfiles/bun.js";
import { cargoLockfile } from "../src/lockfiles/cargo.js";
import { npmLockfile } from "../src/lockfiles/npm.js";
import { pubLockfile } from "../src/lockfiles/pub.js";
import type { ParsedLockfile } from "../src/types.js";
import { readFixture } from "./helpers/fixtures.js";

function sorted(parsed: ParsedLockfile): string[] {
  return parsed.refs.map((ref) => `${ref.registry}:${ref.name}@${ref.version}`).sort();
}

describe("npm package-lock.json", () => {
  it("collects every registry-resolved version including nested duplicates", () => {
    const refs = npmLockfile.parse(
      readFixture("npm/head/package-lock.json"),
      "package-lock.json",
    );

    expect(sorted(refs)).toEqual([
      "npm:left-pad@1.3.0",
      "npm:nested-dep@2.0.0",
      "npm:tiny-invariant@1.3.4",
    ]);
  });

  it("ignores the root project, workspace members and symlinks", () => {
    const parsed = npmLockfile.parse(
      readFixture("npm/base/package-lock.json"),
      "package-lock.json",
    );

    expect(parsed.refs.some((ref) => ref.name === "workspace-lib")).toBe(false);
    expect(parsed.refs.some((ref) => ref.name === "demo-app")).toBe(false);
    expect(parsed.uncheckable).toEqual([]);
  });

  it("rejects lockfileVersion 1 rather than silently under-reporting", () => {
    expect(() =>
      npmLockfile.parse(
        JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
        "package-lock.json",
      ),
    ).toThrow(/lockfileVersion 1/);
  });
});

describe("bun.lock", () => {
  it("parses the JSONC text lockfile and skips workspace and git entries", () => {
    const refs = bunLockfile.parse(readFixture("bun/head/bun.lock"), "bun.lock");

    expect(sorted(refs)).toEqual([
      "npm:@scope/util@2.2.0",
      "npm:left-pad@1.3.0",
      "npm:tslib@2.8.1",
    ]);
  });

  it("refuses the binary bun.lockb instead of skipping it", () => {
    expect(() => bunLockfile.parse("#!\u0000binary\u0000", "bun.lockb")).toThrow(
      /bun\.lockb/,
    );
  });

  it("resolves scoped package names whose version contains an @", () => {
    const parsed = bunLockfile.parse(readFixture("bun/base/bun.lock"), "bun.lock");
    const scoped = parsed.refs.find((ref) => ref.name === "@scope/util");

    expect(scoped?.version).toBe("2.1.0");
  });

  it("recognises a git dependency whose URL itself contains an @", () => {
    const parsed = bunLockfile.parse(
      '{ "packages": { "forked": ["forked@git+ssh://git@github.com/acme/forked#c0ffee"] } }',
      "bun.lock",
    );

    expect(parsed.refs).toEqual([]);
    expect(parsed.uncheckable).toEqual([
      { name: "forked", version: null, reason: "resolved via git+" },
    ]);
  });

  it("reports git and workspace entries as uncheckable rather than dropping them", () => {
    const parsed = bunLockfile.parse(readFixture("bun/base/bun.lock"), "bun.lock");

    expect(parsed.uncheckable.map((entry) => entry.name).sort()).toEqual([
      "patched-thing",
      "workspace-lib",
    ]);
  });
});

describe("pubspec.lock", () => {
  it("collects only hosted packages", () => {
    const parsed = pubLockfile.parse(readFixture("pub/head/pubspec.lock"), "pubspec.lock");

    expect(sorted(parsed)).toEqual([
      "pub:collection@1.19.0",
      "pub:http@1.3.0",
      "pub:http_parser@4.1.2",
    ]);
  });

  it("reports path and git packages as uncheckable", () => {
    const parsed = pubLockfile.parse(readFixture("pub/head/pubspec.lock"), "pubspec.lock");

    expect(parsed.uncheckable.map((entry) => entry.name).sort()).toEqual([
      "internal_widgets",
      "some_fork",
    ]);
  });
});

describe("Cargo.lock", () => {
  it("collects only crates resolved from crates.io", () => {
    const parsed = cargoLockfile.parse(readFixture("cargo/head/Cargo.lock"), "Cargo.lock");

    expect(sorted(parsed)).toEqual([
      "cargo:once_cell@1.20.2",
      "cargo:serde@1.0.213",
      "cargo:serde_derive@1.0.213",
    ]);
  });

  it("reports git-sourced crates as uncheckable but ignores workspace members", () => {
    const parsed = cargoLockfile.parse(readFixture("cargo/head/Cargo.lock"), "Cargo.lock");

    expect(parsed.uncheckable.map((entry) => entry.name)).toEqual(["patched-crate"]);
  });
});
