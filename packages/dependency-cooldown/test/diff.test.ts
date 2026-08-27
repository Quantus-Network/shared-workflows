import { describe, expect, it } from "vitest";

import { findIntroducedDependencies } from "../src/diff.js";
import { collectFromLockfile } from "../src/lockfiles/index.js";
import type { LockedDependency } from "../src/types.js";
import { readFixture } from "./helpers/fixtures.js";

function keys(deps: LockedDependency[]): string[] {
  return deps.map((dep) => `${dep.registry}:${dep.name}@${dep.version}`).sort();
}

function collect(ecosystem: string, side: string, lockfile: string): LockedDependency[] {
  return collectFromLockfile(lockfile, readFixture(`${ecosystem}/${side}/${lockfile}`));
}

describe("findIntroducedDependencies", () => {
  it("reports only versions absent from the base lockfile", () => {
    const base = collect("npm", "base", "package-lock.json");
    const head = collect("npm", "head", "package-lock.json");

    expect(keys(findIntroducedDependencies(base, head))).toEqual([
      "npm:nested-dep@2.0.0",
      "npm:tiny-invariant@1.3.4",
    ]);
  });

  it("treats a removed dependency as no change", () => {
    const base = collect("npm", "head", "package-lock.json");
    const head = base.filter((dep) => dep.name !== "nested-dep");

    expect(findIntroducedDependencies(base, head)).toEqual([]);
  });

  it("flags a downgrade, since the older version was not previously vetted here", () => {
    const base = collect("npm", "head", "package-lock.json");
    const head = collect("npm", "base", "package-lock.json");

    expect(keys(findIntroducedDependencies(base, head))).toEqual(["npm:tiny-invariant@1.3.3"]);
  });

  it("does not re-flag a version that already exists under another lockfile", () => {
    const base: LockedDependency[] = [
      { registry: "npm", name: "left-pad", version: "1.3.0", lockfile: "a/package-lock.json" },
    ];
    const head: LockedDependency[] = [
      { registry: "npm", name: "left-pad", version: "1.3.0", lockfile: "b/package-lock.json" },
    ];

    expect(findIntroducedDependencies(base, head)).toEqual([]);
  });

  it("deduplicates a version introduced by several lockfiles at once", () => {
    const head: LockedDependency[] = [
      { registry: "npm", name: "tslib", version: "2.8.1", lockfile: "a/bun.lock" },
      { registry: "npm", name: "tslib", version: "2.8.1", lockfile: "b/bun.lock" },
    ];

    expect(findIntroducedDependencies([], head)).toHaveLength(1);
  });

  it("keeps registries separate so a cargo crate never masks an npm package", () => {
    const base: LockedDependency[] = [
      { registry: "cargo", name: "serde", version: "1.0.213", lockfile: "Cargo.lock" },
    ];
    const head: LockedDependency[] = [
      ...base,
      { registry: "npm", name: "serde", version: "1.0.213", lockfile: "package-lock.json" },
    ];

    expect(keys(findIntroducedDependencies(base, head))).toEqual(["npm:serde@1.0.213"]);
  });

  it("flags every dependency when there is no base state, as the audit does", () => {
    const head = collect("cargo", "head", "Cargo.lock");

    expect(findIntroducedDependencies([], head)).toHaveLength(3);
  });
});
