import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BYPASS_REASON_MARKER } from "../src/bypass.js";
import type { HttpClient } from "../src/registries/http.js";
import { DEFAULT_BYPASS_LABEL, run } from "../src/run.js";
import { CLOUDFLARE_PAGES_BUN_LOCKB_MARKER } from "../src/scan.js";
import { readFixture } from "./helpers/fixtures.js";

const NOW = new Date("2026-08-27T12:00:00Z");
const OLD = "2020-01-01T00:00:00.000Z";
const FRESH = "2026-08-25T00:00:00.000Z";

/**
 * Publish dates keyed by `name@version`; anything not listed is old enough to
 * pass, so each test only declares the versions it cares about.
 */
function httpStub(fresh: Record<string, true>): HttpClient {
  return {
    async getJson(url) {
      if (url.startsWith("https://registry.npmjs.org/")) {
        const name = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
        const time: Record<string, string> = {};
        for (const version of ["1.3.0", "1.3.3", "1.3.4", "2.0.0", "2.1.0", "2.2.0", "2.8.1"]) {
          time[version] = fresh[`${name}@${version}`] ? FRESH : OLD;
        }
        return { time };
      }
      if (url.startsWith("https://crates.io/api/v1/crates/")) {
        const [name, version] = url.slice("https://crates.io/api/v1/crates/".length).split("/");
        return {
          version: { num: version, created_at: fresh[`${name}@${version}`] ? FRESH : OLD },
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  };
}

let repoDir: string;
let summaryPath: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

function write(relativePath: string, contents: string): void {
  const absolute = join(repoDir, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function commit(message: string): string {
  git("add", "-A");
  git("-c", "user.email=ci@example.com", "-c", "user.name=CI", "commit", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

function summary(): string {
  return readFileSync(summaryPath, "utf8");
}

function setEvent(pullRequest: { labels?: string[]; body?: string | null }): void {
  const path = join(repoDir, "event.json");
  writeFileSync(
    path,
    JSON.stringify({
      pull_request: {
        number: 7,
        body: pullRequest.body ?? null,
        labels: (pullRequest.labels ?? []).map((name) => ({ name })),
      },
    }),
  );
  process.env.GITHUB_EVENT_PATH = path;
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "cooldown-e2e-"));
  git("init", "--initial-branch=main");
  summaryPath = join(repoDir, "summary.md");
  writeFileSync(summaryPath, "");
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  delete process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_OUTPUT;
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  delete process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_EVENT_PATH;
});

describe("check mode", () => {
  it("passes when the introduced version is older than the cooldown", async () => {
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("bump");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({}),
      now: NOW,
    });

    expect(code).toBe(0);
    expect(summary()).toContain("No dependency is newer than the cooldown window.");
  });

  it("fails when a freshly published version is introduced", async () => {
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("bump");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(1);
    expect(summary()).toContain("tiny-invariant");
    expect(summary()).toContain("How to resolve");
  });

  it("ignores a fresh version that was already present in the base", async () => {
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    const baseSha = commit("base");
    write("README.md", "no dependency change\n");
    commit("docs");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(0);
  });

  it("checks every dependency of a lockfile added by the pull request", async () => {
    write("README.md", "start\n");
    const baseSha = commit("base");
    write("Cargo.lock", readFixture("cargo/head/Cargo.lock"));
    commit("add rust crate");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "once_cell@1.20.2": true }),
      now: NOW,
    });

    expect(code).toBe(1);
    expect(summary()).toContain("once_cell");
  });

  it("does not flag dependencies of a lockfile that merely moved", async () => {
    write("app/package-lock.json", readFixture("npm/head/package-lock.json"));
    const baseSha = commit("base");
    rmSync(join(repoDir, "app/package-lock.json"));
    write("services/app/package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("move app");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(0);
  });

  it("allows a violation through when the bypass label carries a reason", async () => {
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("bump");
    setEvent({
      labels: [DEFAULT_BYPASS_LABEL],
      body: `${BYPASS_REASON_MARKER} CVE-2026-1234 lets an attacker run code in prod`,
    });

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(0);
    expect(summary()).toContain("Cooldown bypassed");
    expect(summary()).toContain("CVE-2026-1234");
  });

  it("refuses a bypass label with no stated reason", async () => {
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("base");
    setEvent({ labels: [DEFAULT_BYPASS_LABEL], body: "please merge" });

    await expect(
      run(["--mode=check", "--base-ref=HEAD", `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(new RegExp(BYPASS_REASON_MARKER));
  });

  it("fails the run when a repository config lowers the cooldown", async () => {
    write(".github/dependency-cooldown.yml", "minReleaseAgeDays: 3\n");
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    const baseSha = commit("base");

    await expect(
      run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/below the organisation floor/);
  });

  it("enforces a stricter cooldown when the repository raises it", async () => {
    write(".github/dependency-cooldown.yml", "minReleaseAgeDays: 3650\n");
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("bump");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({}),
      now: NOW,
    });

    expect(code).toBe(1);
  });

  it("checks several ecosystems in one repository", async () => {
    write("README.md", "start\n");
    const baseSha = commit("base");
    write("frontend/package-lock.json", readFixture("npm/head/package-lock.json"));
    write("engine/Cargo.lock", readFixture("cargo/head/Cargo.lock"));
    commit("add stacks");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "serde@1.0.213": true }),
      now: NOW,
    });

    expect(code).toBe(1);
    expect(summary()).toContain("engine/Cargo.lock");
    expect(summary()).toContain("Checked 6 newly introduced dependency version(s)");
  });

  it("checks bun.lock when the Cloudflare Pages dummy bun.lockb sits beside it", async () => {
    write("bun.lock", readFixture("bun/base/bun.lock"));
    write("bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);
    const baseSha = commit("base");
    write("bun.lock", readFixture("bun/head/bun.lock"));
    commit("bump bun");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tslib@2.8.1": true }),
      now: NOW,
    });

    expect(code).toBe(1);
    expect(summary()).toContain("tslib");
    expect(summary()).toContain("bun.lock");
  });

  it("refuses a PR that replaces the dummy bun.lockb with a real lockfile while bun.lock is unchanged", async () => {
    write("bun.lock", readFixture("bun/base/bun.lock"));
    write("bun.lockb", CLOUDFLARE_PAGES_BUN_LOCKB_MARKER);
    const baseSha = commit("base");
    write("bun.lockb", "#!\u0000binary\u0000");
    commit("swap in a real bun.lockb");

    await expect(
      run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/bun\.lockb/);
  });

  it("refuses a divergent non-marker bun.lockb sitting beside bun.lock", async () => {
    write("bun.lock", readFixture("bun/base/bun.lock"));
    write("bun.lockb", "#!\u0000binary\u0000");
    const baseSha = commit("base");

    await expect(
      run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/bun\.lockb/);
  });

  it("still refuses a repository that only has bun.lockb", async () => {
    write("bun.lockb", "#!\u0000binary\u0000");
    const baseSha = commit("base");

    await expect(
      run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/bun\.lockb/);
  });

  it("refuses to run in a repository with no lockfile", async () => {
    write("README.md", "nothing to lock\n");
    const baseSha = commit("base");

    await expect(
      run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/No supported lockfile/);
  });

  it("still checks a lockfile in a directory called build", async () => {
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("packages/build/Cargo.lock", readFixture("cargo/head/Cargo.lock"));
    commit("add a package named build");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "serde@1.0.213": true }),
      now: NOW,
    });

    expect(code).toBe(1);
    expect(summary()).toContain("packages/build/Cargo.lock");
  });

  it("ignores lockfiles vendored under node_modules", async () => {
    write("package-lock.json", readFixture("npm/base/package-lock.json"));
    const baseSha = commit("base");
    write("node_modules/some-dep/package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("vendor");

    const code = await run(["--mode=check", `--base-ref=${baseSha}`, `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(0);
  });
});

describe("audit mode", () => {
  it("reports the whole locked dependency set without blocking", async () => {
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("base");

    const code = await run(["--mode=audit", `--repo-dir=${repoDir}`], {
      http: httpStub({ "tiny-invariant@1.3.4": true }),
      now: NOW,
    });

    expect(code).toBe(0);
    expect(summary()).toContain("does not block");
    expect(summary()).toContain("tiny-invariant");
  });

  it("rejects a base ref, which audit mode would otherwise ignore silently", async () => {
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("base");

    await expect(
      run(["--mode=audit", "--base-ref=HEAD", `--repo-dir=${repoDir}`], {
        http: httpStub({}),
        now: NOW,
      }),
    ).rejects.toThrow(/not used in audit mode/);
  });

  it("ignores the bypass label, since it never blocks anyway", async () => {
    write("package-lock.json", readFixture("npm/head/package-lock.json"));
    commit("base");
    setEvent({ labels: [DEFAULT_BYPASS_LABEL], body: "no reason given" });

    const code = await run(["--mode=audit", `--repo-dir=${repoDir}`], {
      http: httpStub({}),
      now: NOW,
    });

    expect(code).toBe(0);
  });
});
