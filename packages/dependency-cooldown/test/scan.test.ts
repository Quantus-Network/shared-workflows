import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLOUDFLARE_PAGES_BUN_LOCKB_MARKER,
  discoverLockfiles,
  listLockfilesAtRef,
} from "../src/scan.js";

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

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

function commit(message: string): string {
  git("add", "-A");
  git("-c", "user.email=ci@example.com", "-c", "user.name=CI", "commit", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

describe("Cloudflare Pages dummy bun.lockb", () => {
  it("is the 189-byte Quantus marker with no trailing newline", () => {
    expect(Buffer.byteLength(CLOUDFLARE_PAGES_BUN_LOCKB_MARKER)).toBe(189);
    expect(CLOUDFLARE_PAGES_BUN_LOCKB_MARKER.endsWith("\n")).toBe(false);
    expect(CLOUDFLARE_PAGES_BUN_LOCKB_MARKER).toBe(
      "# THIS IS JUST DUMMY FILE FOR HELPING CLOUDFLARE DETECT BUN PACKAGE MANAGER (https://community.cloudflare.com/t/bun-not-detected-as-tool-when-using-new-bun-lock-instead-of-bun-lockb/779835)",
    );
  });
});

describe("discoverLockfiles", () => {
  it("omits bun.lockb only when it is the Cloudflare Pages dummy beside bun.lock", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock"]);
  });

  it("keeps an empty bun.lockb sitting beside bun.lock", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", "");

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock", "bun.lockb"]);
  });

  it("keeps a real binary bun.lockb sitting beside bun.lock", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", "#!\u0000binary\u0000");

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock", "bun.lockb"]);
  });

  it("does not treat a different 189-byte file as the dummy", () => {
    const impostor = `X${CLOUDFLARE_PAGES_BUN_LOCKB_MARKER.slice(1)}`;
    expect(Buffer.byteLength(impostor)).toBe(189);

    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", impostor);

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock", "bun.lockb"]);
  });

  it("does not treat a marker with a trailing newline as the dummy", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", `${CLOUDFLARE_PAGES_BUN_LOCKB_MARKER}\n`);

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lock", "bun.lockb"]);
  });

  it("still discovers bun.lockb when no text lockfile is present", () => {
    write("bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);

    expect(discoverLockfiles(repoDir)).toEqual(["bun.lockb"]);
  });

  it("does not treat a bun.lock in another directory as covering bun.lockb", () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("apps/web/bun.lockb", "#!\u0000binary\u0000");

    expect(discoverLockfiles(repoDir)).toEqual(["apps/web/bun.lockb", "bun.lock"]);
  });

  it("omits a nested dummy bun.lockb next to bun.lock", () => {
    write("apps/web/bun.lock", '{ "packages": {} }\n');
    write("apps/web/bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);

    expect(discoverLockfiles(repoDir)).toEqual(["apps/web/bun.lock"]);
  });

  it("keeps a nested non-marker bun.lockb next to bun.lock", () => {
    write("apps/web/bun.lock", '{ "packages": {} }\n');
    write("apps/web/bun.lockb", "#!\u0000binary\u0000");

    expect(discoverLockfiles(repoDir)).toEqual(["apps/web/bun.lock", "apps/web/bun.lockb"]);
  });
});

describe("listLockfilesAtRef", () => {
  beforeEach(() => {
    git("init", "--initial-branch=main");
  });

  it("omits the Cloudflare Pages dummy bun.lockb beside bun.lock", async () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);
    const sha = commit("dummy");

    expect(await listLockfilesAtRef(repoDir, sha)).toEqual(["bun.lock"]);
  });

  it("keeps a same-length impostor bun.lockb at that revision", async () => {
    const impostor = `X${CLOUDFLARE_PAGES_BUN_LOCKB_MARKER.slice(1)}`;
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", impostor);
    const sha = commit("impostor");

    expect(await listLockfilesAtRef(repoDir, sha)).toEqual(["bun.lock", "bun.lockb"]);
  });

  it("keeps a real bun.lockb beside bun.lock at that revision", async () => {
    write("bun.lock", '{ "packages": {} }\n');
    write("bun.lockb", "#!\u0000binary\u0000");
    const sha = commit("binary");

    expect(await listLockfilesAtRef(repoDir, sha)).toEqual(["bun.lock", "bun.lockb"]);
  });
});
