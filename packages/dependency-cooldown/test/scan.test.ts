import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverLockfiles } from "../src/scan.js";

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "cooldown-scan-"));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

function write(relativePath: string, contents: string): void {
  const absolute = join(repoDir, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

describe("discoverLockfiles", () => {
  it("omits bun.lockb when a text bun.lock sits beside it", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", "");

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock"]);
  });

  it("still discovers bun.lockb when no text lockfile is present", () => {
    write("bun.lockb", "");

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lockb"]);
  });

  it("does not treat a bun.lock in another directory as covering bun.lockb", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("apps/web/bun.lockb", "");

    expect(discoverLockfiles(repoDir)).toEqual(["apps/web/bun.lockb", "bun.lock"]);
  });

  it("omits bun.lockb next to bun.lock in a nested directory", () => {
    write("apps/web/bun.lock", '{ "packages": {} }\n');
    write("apps/web/bun.lockb", "");

    expect(discoverLockfiles(repoDir)).toEqual(["apps/web/bun.lock"]);
  });
});
