import { UsageError } from "./errors.js";

/** Line prefix the pull request body must use to justify a bypass. */
export const BYPASS_REASON_MARKER = "Cooldown-bypass-reason:";

const MIN_REASON_LENGTH = 20;

export interface BypassInput {
  labels: readonly string[];
  body: string | null;
  bypassLabel: string;
}

export type Bypass = { active: false } | { active: true; reason: string };

export function resolveBypass({ labels, body, bypassLabel }: BypassInput): Bypass {
  const wanted = bypassLabel.toLowerCase();
  if (!labels.some((label) => label.toLowerCase() === wanted)) {
    return { active: false };
  }

  const line = (body ?? "")
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(BYPASS_REASON_MARKER));

  if (line === undefined) {
    throw new UsageError(
      `The "${bypassLabel}" label is applied but the pull request body has no "${BYPASS_REASON_MARKER}" line. Add one explaining why this dependency cannot wait out the cooldown.`,
    );
  }

  const reason = line.slice(BYPASS_REASON_MARKER.length).trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new UsageError(
      `The "${BYPASS_REASON_MARKER}" line must be at least ${MIN_REASON_LENGTH} characters; got ${reason.length}. Describe the emergency, for example the CVE or the incident being mitigated.`,
    );
  }

  return { active: true, reason };
}
