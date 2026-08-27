import { describe, expect, it } from "vitest";

import type { Finding } from "../src/policy.js";
import { renderSummary, violationMessage } from "../src/report.js";

const finding: Finding = {
  dependency: {
    registry: "npm",
    name: "left-pad",
    version: "1.4.0",
    lockfile: "package-lock.json",
  },
  publishedAt: new Date("2026-08-25T00:00:00Z"),
  ageDays: 2,
};

const base = {
  minReleaseAgeDays: 30,
  checkedCount: 4,
  uncheckable: [],
  bypassLabel: "dependency-cooldown-bypass",
} as const;

describe("violationMessage", () => {
  it("states the age, the requirement and the remaining wait", () => {
    const message = violationMessage(finding, 30);

    expect(message).toContain("left-pad@1.4.0");
    expect(message).toContain("published 2 day(s) ago");
    expect(message).toContain("30 day cooldown");
    expect(message).toContain("Wait 28 more day(s)");
  });
});

describe("renderSummary", () => {
  it("reports a clean check", () => {
    const summary = renderSummary({
      ...base,
      mode: "check",
      violations: [],
      bypassReason: null,
    });

    expect(summary).toContain("No dependency is newer than the cooldown window.");
    expect(summary).not.toContain("How to resolve");
  });

  it("lists violations and how to resolve them", () => {
    const summary = renderSummary({
      ...base,
      mode: "check",
      violations: [finding],
      bypassReason: null,
    });

    expect(summary).toContain("| [left-pad](https://www.npmjs.com/package/left-pad/v/1.4.0) |");
    expect(summary).toContain("2026-08-25");
    expect(summary).toContain("How to resolve");
  });

  it("records the bypass reason prominently when one was used", () => {
    const summary = renderSummary({
      ...base,
      mode: "check",
      violations: [finding],
      bypassReason: "CVE-2026-1234 remote code execution",
      bypassLabel: "dependency-cooldown-bypass",
    });

    expect(summary).toContain("Cooldown bypassed");
    expect(summary).toContain("CVE-2026-1234 remote code execution");
    expect(summary).not.toContain("How to resolve");
  });

  it("says the audit does not block", () => {
    const summary = renderSummary({
      ...base,
      mode: "audit",
      violations: [finding],
      bypassReason: null,
    });

    expect(summary).toContain("does not block");
  });

  it("discloses dependencies it could not age-check", () => {
    const summary = renderSummary({
      ...base,
      mode: "check",
      violations: [],
      bypassReason: null,
      uncheckable: [
        {
          name: "patched-crate",
          version: "0.6.0",
          reason: "source is git+https://github.com/acme/patched-crate, not crates.io",
          lockfile: "Cargo.lock",
        },
      ],
    });

    expect(summary).toContain("could not be age-checked");
    expect(summary).toContain("patched-crate");
  });
});
