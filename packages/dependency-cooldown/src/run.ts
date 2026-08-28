import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { type Bypass, resolveBypass } from "./bypass.js";
import { CONFIG_PATH, parseConfig } from "./config.js";
import { findIntroducedDependencies } from "./diff.js";
import { UsageError } from "./errors.js";
import { annotate, readPullRequestContext, setOutput, writeStepSummary } from "./github.js";
import { ORG_MIN_RELEASE_AGE_DAYS, evaluatePolicy } from "./policy.js";
import { type HttpClient, createHttpClient } from "./registries/http.js";
import { renderSummary, violationMessage } from "./report.js";
import { type Clock, resolvePublishDates } from "./resolve.js";
import { discoverLockfiles, listLockfilesAtRef, scanRef, scanWorkingTree } from "./scan.js";

export const DEFAULT_BYPASS_LABEL = "dependency-cooldown-bypass";

/** Exit code meaning "the run itself failed", as opposed to 1 for a violation. */
export const EXIT_USAGE = 2;

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

interface CliArgs {
  mode: "check" | "audit";
  baseRef: string | undefined;
  repoDir: string;
  bypassLabel: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "check" },
      "base-ref": { type: "string" },
      "repo-dir": { type: "string", default: "." },
      "bypass-label": { type: "string", default: DEFAULT_BYPASS_LABEL },
    },
    strict: true,
  });

  const mode = values.mode;
  if (mode !== "check" && mode !== "audit") {
    throw new UsageError(`--mode must be "check" or "audit", got "${String(mode)}".`);
  }
  const baseRef = values["base-ref"];
  if (mode === "check" && baseRef === undefined) {
    throw new UsageError("--base-ref is required in check mode.");
  }
  if (mode === "audit" && baseRef !== undefined) {
    throw new UsageError(
      "--base-ref is not used in audit mode, which checks the whole locked dependency set. Remove it so the intent is unambiguous.",
    );
  }

  return {
    mode,
    baseRef,
    repoDir: resolve(values["repo-dir"] as string),
    bypassLabel: values["bypass-label"] as string,
  };
}

export interface RunOverrides {
  /** Injected by tests so no registry is contacted. */
  http?: HttpClient;
  now?: Date;
  /** Injected by tests so crates.io pacing does not sleep in wall-clock time. */
  clock?: Clock;
}

export async function run(argv: string[], overrides: RunOverrides = {}): Promise<number> {
  const { mode, baseRef, repoDir, bypassLabel } = parseCliArgs(argv);
  const http = overrides.http ?? createHttpClient();
  const now = overrides.now ?? new Date();

  const config = parseConfig(
    await readOptionalFile(join(repoDir, CONFIG_PATH)),
    ORG_MIN_RELEASE_AGE_DAYS,
  );

  let bypass: Bypass = { active: false };
  if (mode === "check") {
    const pullRequest = readPullRequestContext(process.env.GITHUB_EVENT_PATH);
    bypass = resolveBypass({
      labels: pullRequest?.labels ?? [],
      body: pullRequest?.body ?? null,
      bypassLabel,
    });
  }

  const headLockfiles = discoverLockfiles(repoDir);
  if (headLockfiles.length === 0) {
    throw new UsageError(
      "No supported lockfile found in the repository. Commit a lockfile, or stop calling this workflow.",
    );
  }
  console.log(`Lockfiles: ${headLockfiles.join(", ")}`);

  const head = await scanWorkingTree(repoDir, headLockfiles);

  let baseDependencies: Awaited<ReturnType<typeof scanRef>>["dependencies"] = [];
  if (mode === "check") {
    const ref = baseRef as string;
    const paths = [...new Set([...headLockfiles, ...(await listLockfilesAtRef(repoDir, ref))])];
    baseDependencies = (await scanRef(repoDir, ref, paths)).dependencies;
  }

  const subjects = findIntroducedDependencies(baseDependencies, head.dependencies);
  console.log(
    mode === "check"
      ? `${subjects.length} newly introduced dependency version(s) to verify.`
      : `${subjects.length} locked dependency version(s) to verify.`,
  );

  const dated = await resolvePublishDates(subjects, http, overrides.clock);
  const { violations } = evaluatePolicy(dated, {
    minReleaseAgeDays: config.minReleaseAgeDays,
    now,
  });

  writeStepSummary(
    renderSummary({
      mode,
      minReleaseAgeDays: config.minReleaseAgeDays,
      checkedCount: subjects.length,
      violations,
      uncheckable: head.uncheckable,
      bypassReason: bypass.active ? bypass.reason : null,
      bypassLabel,
    }),
  );
  setOutput("violation-count", String(violations.length));
  setOutput("min-release-age-days", String(config.minReleaseAgeDays));

  const blocking = mode === "check" && !bypass.active;
  for (const finding of violations) {
    annotate(
      blocking ? "error" : "warning",
      violationMessage(finding, config.minReleaseAgeDays),
      finding.dependency.lockfile,
    );
  }

  if (violations.length === 0) {
    console.log("All checked dependency versions are older than the cooldown window.");
    return 0;
  }
  if (bypass.active) {
    annotate(
      "warning",
      `Dependency cooldown bypassed for ${violations.length} version(s) via the "${bypassLabel}" label. Reason: ${bypass.reason}`,
    );
    return 0;
  }
  return blocking ? 1 : 0;
}
