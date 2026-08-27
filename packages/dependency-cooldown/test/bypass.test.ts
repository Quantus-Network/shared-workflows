import { describe, expect, it } from "vitest";

import { BYPASS_REASON_MARKER, resolveBypass } from "../src/bypass.js";

const LABEL = "dependency-cooldown-bypass";

describe("resolveBypass", () => {
  it("is inactive when the label is absent", () => {
    const bypass = resolveBypass({
      labels: ["dependencies"],
      body: `${BYPASS_REASON_MARKER} not actually requested`,
      bypassLabel: LABEL,
    });

    expect(bypass.active).toBe(false);
  });

  it("is active with the reason taken from the pull request body", () => {
    const bypass = resolveBypass({
      labels: ["dependencies", LABEL],
      body: `Fixes prod.\n\n${BYPASS_REASON_MARKER} CVE-2026-1234 remote code execution in prod\n`,
      bypassLabel: LABEL,
    });

    expect(bypass).toEqual({
      active: true,
      reason: "CVE-2026-1234 remote code execution in prod",
    });
  });

  it("rejects a bypass with no reason marker", () => {
    expect(() =>
      resolveBypass({ labels: [LABEL], body: "Urgent, please merge", bypassLabel: LABEL }),
    ).toThrow(new RegExp(BYPASS_REASON_MARKER));
  });

  it("rejects a bypass whose reason is too short to be meaningful", () => {
    expect(() =>
      resolveBypass({
        labels: [LABEL],
        body: `${BYPASS_REASON_MARKER} urgent`,
        bypassLabel: LABEL,
      }),
    ).toThrow(/at least/);
  });

  it("rejects a bypass on a pull request with an empty body", () => {
    expect(() => resolveBypass({ labels: [LABEL], body: null, bypassLabel: LABEL })).toThrow(
      new RegExp(BYPASS_REASON_MARKER),
    );
  });

  it("matches the label case-insensitively", () => {
    const bypass = resolveBypass({
      labels: ["Dependency-Cooldown-Bypass"],
      body: `${BYPASS_REASON_MARKER} rotating a leaked credential in the sdk`,
      bypassLabel: LABEL,
    });

    expect(bypass.active).toBe(true);
  });
});
