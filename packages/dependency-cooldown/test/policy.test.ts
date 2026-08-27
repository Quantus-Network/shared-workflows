import { describe, expect, it } from "vitest";

import { ORG_MIN_RELEASE_AGE_DAYS, evaluatePolicy } from "../src/policy.js";
import type { LockedDependency } from "../src/types.js";

const NOW = new Date("2026-08-27T12:00:00Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function dep(name: string): LockedDependency {
  return { registry: "npm", name, version: "1.0.0", lockfile: "package-lock.json" };
}

describe("evaluatePolicy", () => {
  it("uses a 30 day organisation floor", () => {
    expect(ORG_MIN_RELEASE_AGE_DAYS).toBe(30);
  });

  it("rejects a version published less than the cooldown ago", () => {
    const result = evaluatePolicy(
      [{ dependency: dep("fresh"), publishedAt: daysBefore(3) }],
      { minReleaseAgeDays: 30, now: NOW },
    );

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ageDays).toBe(3);
    expect(result.compliant).toHaveLength(0);
  });

  it("accepts a version published exactly at the cooldown boundary", () => {
    const result = evaluatePolicy(
      [{ dependency: dep("boundary"), publishedAt: daysBefore(30) }],
      { minReleaseAgeDays: 30, now: NOW },
    );

    expect(result.violations).toEqual([]);
    expect(result.compliant).toHaveLength(1);
  });

  it("rejects a version one hour short of the cooldown boundary", () => {
    const publishedAt = new Date(daysBefore(30).getTime() + 60 * 60 * 1000);
    const result = evaluatePolicy([{ dependency: dep("nearly"), publishedAt }], {
      minReleaseAgeDays: 30,
      now: NOW,
    });

    expect(result.violations).toHaveLength(1);
  });

  it("honours a stricter repository cooldown", () => {
    const result = evaluatePolicy(
      [{ dependency: dep("fresh"), publishedAt: daysBefore(45) }],
      { minReleaseAgeDays: 60, now: NOW },
    );

    expect(result.violations).toHaveLength(1);
  });

  it("rejects a publish date in the future", () => {
    expect(() =>
      evaluatePolicy([{ dependency: dep("skewed"), publishedAt: daysBefore(-1) }], {
        minReleaseAgeDays: 30,
        now: NOW,
      }),
    ).toThrow(/future/);
  });

  it("sorts violations by age so the newest package is reported first", () => {
    const result = evaluatePolicy(
      [
        { dependency: dep("older"), publishedAt: daysBefore(20) },
        { dependency: dep("newest"), publishedAt: daysBefore(1) },
      ],
      { minReleaseAgeDays: 30, now: NOW },
    );

    expect(result.violations.map((finding) => finding.dependency.name)).toEqual([
      "newest",
      "older",
    ]);
  });
});
