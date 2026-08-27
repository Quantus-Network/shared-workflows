import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("falls back to the organisation floor when no config file exists", () => {
    expect(parseConfig(undefined)).toEqual({ minReleaseAgeDays: 30 });
  });

  it("falls back to the organisation floor for an empty config file", () => {
    expect(parseConfig("# nothing set\n")).toEqual({ minReleaseAgeDays: 30 });
  });

  it("allows a repository to raise the cooldown", () => {
    expect(parseConfig("minReleaseAgeDays: 90\n")).toEqual({ minReleaseAgeDays: 90 });
  });

  it("refuses a cooldown below the organisation floor instead of clamping it", () => {
    expect(() => parseConfig("minReleaseAgeDays: 7\n")).toThrow(
      /below the organisation floor of 30/,
    );
  });

  it("refuses a non-integer cooldown", () => {
    expect(() => parseConfig("minReleaseAgeDays: 30.5\n")).toThrow(/whole number/);
  });

  it("refuses unknown keys so typos cannot silently disable the policy", () => {
    expect(() => parseConfig("minReleaseAge: 60\n")).toThrow(/Unknown.*minReleaseAge/s);
  });

  it("refuses a config file that is not a mapping", () => {
    expect(() => parseConfig("- 30\n")).toThrow(/mapping/);
  });
});
