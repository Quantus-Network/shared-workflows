import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

const BUNDLE = fileURLToPath(
  new URL("../../../actions/dependency-cooldown/dist/index.mjs", import.meta.url),
);

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

async function runBundle(args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run("node", [BUNDLE, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

let repoDir: string;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "cooldown-bundle-"));
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

/**
 * Exercises the committed bundle as a process. Unit tests import TypeScript
 * sources directly and so cannot catch bundling faults, such as a dependency
 * that only works when bundled as CommonJS.
 */
describe("committed action bundle", () => {
  it("exists", () => {
    expect(
      existsSync(BUNDLE),
      `${BUNDLE} is missing. Run "npm run build" before the tests.`,
    ).toBe(true);
  });

  it("loads every bundled dependency and reports a usage error cleanly", async () => {
    const outcome = await runBundle([`--repo-dir=${repoDir}`, "--mode=audit"]);

    expect(outcome.stderr).not.toContain("Dynamic require");
    expect(outcome.stdout).toContain("No supported lockfile");
    expect(outcome.code).toBe(2);
  });

  it("parses YAML config through the bundle", async () => {
    writeFileSync(join(repoDir, "cooldown.yml"), "minReleaseAgeDays: 1\n");
    const configDir = join(repoDir, ".github");
    rmSync(configDir, { recursive: true, force: true });
    writeFileSync(join(repoDir, "pubspec.lock"), "packages: {}\n");

    const outcome = await runBundle([`--repo-dir=${repoDir}`, "--mode=audit"]);

    expect(outcome.stderr).not.toContain("Dynamic require");
    expect(outcome.stdout).toContain("0 locked dependency version(s) to verify");
    expect(outcome.code).toBe(0);
  });

  it("rejects an unknown flag instead of ignoring it", async () => {
    const outcome = await runBundle([`--repo-dir=${repoDir}`, "--allow-everything"]);

    expect(outcome.code).toBe(2);
  });
});
