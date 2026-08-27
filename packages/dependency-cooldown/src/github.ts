import { appendFileSync, readFileSync } from "node:fs";

export interface PullRequestContext {
  number: number;
  labels: string[];
  body: string | null;
}

/**
 * Reads labels and body from the webhook payload on disk. This deliberately
 * avoids the GitHub API: the check needs no token and works on forks.
 */
export function readPullRequestContext(eventPath: string | undefined): PullRequestContext | null {
  if (!eventPath) {
    return null;
  }
  const payload = JSON.parse(readFileSync(eventPath, "utf8")) as {
    pull_request?: { number?: unknown; body?: unknown; labels?: { name?: unknown }[] };
  };
  const pullRequest = payload.pull_request;
  if (!pullRequest || typeof pullRequest.number !== "number") {
    return null;
  }
  return {
    number: pullRequest.number,
    labels: (pullRequest.labels ?? [])
      .map((label) => label.name)
      .filter((name): name is string => typeof name === "string"),
    body: typeof pullRequest.body === "string" ? pullRequest.body : null,
  };
}

function escapeAnnotation(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function annotate(
  level: "error" | "warning" | "notice",
  message: string,
  file?: string,
): void {
  const location = file ? ` file=${file},line=1` : "";
  process.stdout.write(`::${level}${location}::${escapeAnnotation(message)}\n`);
}

export function writeStepSummary(markdown: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  appendFileSync(path, `${markdown}\n`);
}

export function setOutput(name: string, value: string): void {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) {
    return;
  }
  const delimiter = `ghadelimiter_${name}`;
  appendFileSync(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
