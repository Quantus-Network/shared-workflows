import type { LockedDependency } from "./types.js";

/**
 * Organisation-wide minimum release age. A repository may raise this but never
 * lower it; see `parseConfig`.
 */
export const ORG_MIN_RELEASE_AGE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DatedDependency {
  dependency: LockedDependency;
  publishedAt: Date;
}

export interface Finding extends DatedDependency {
  /** Whole days between publication and the evaluation time, rounded down. */
  ageDays: number;
}

export interface PolicyResult {
  violations: Finding[];
  compliant: Finding[];
}

export interface PolicyOptions {
  minReleaseAgeDays: number;
  now: Date;
}

export function evaluatePolicy(
  dated: readonly DatedDependency[],
  { minReleaseAgeDays, now }: PolicyOptions,
): PolicyResult {
  const threshold = new Date(now.getTime() - minReleaseAgeDays * MS_PER_DAY);
  const violations: Finding[] = [];
  const compliant: Finding[] = [];

  for (const entry of dated) {
    if (entry.publishedAt.getTime() > now.getTime()) {
      throw new Error(
        `${entry.dependency.name}@${entry.dependency.version} reports a publish date in the future (${entry.publishedAt.toISOString()}).`,
      );
    }
    const finding: Finding = {
      ...entry,
      ageDays: Math.floor((now.getTime() - entry.publishedAt.getTime()) / MS_PER_DAY),
    };
    if (entry.publishedAt.getTime() > threshold.getTime()) {
      violations.push(finding);
    } else {
      compliant.push(finding);
    }
  }

  violations.sort((a, b) => a.ageDays - b.ageDays);
  return { violations, compliant };
}
