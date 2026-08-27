import { parse as parseYaml } from "yaml";

import { UsageError } from "./errors.js";
import { ORG_MIN_RELEASE_AGE_DAYS } from "./policy.js";

/** Path, relative to the repository root, of the optional per-repo override. */
export const CONFIG_PATH = ".github/dependency-cooldown.yml";

export interface CooldownConfig {
  minReleaseAgeDays: number;
}

const KNOWN_KEYS = new Set(["minReleaseAgeDays"]);

export function parseConfig(
  raw: string | undefined,
  orgFloorDays: number = ORG_MIN_RELEASE_AGE_DAYS,
): CooldownConfig {
  if (raw === undefined) {
    return { minReleaseAgeDays: orgFloorDays };
  }

  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch (cause) {
    throw new UsageError(
      `${CONFIG_PATH} is not valid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (document === null || document === undefined) {
    return { minReleaseAgeDays: orgFloorDays };
  }
  if (typeof document !== "object" || Array.isArray(document)) {
    throw new UsageError(`${CONFIG_PATH} must contain a YAML mapping.`);
  }

  const entries = document as Record<string, unknown>;
  const unknown = Object.keys(entries).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown ${CONFIG_PATH} key(s): ${unknown.join(", ")}. Supported keys: ${[...KNOWN_KEYS].join(", ")}.`,
    );
  }

  if (!("minReleaseAgeDays" in entries)) {
    return { minReleaseAgeDays: orgFloorDays };
  }

  const value = entries.minReleaseAgeDays;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new UsageError(
      `${CONFIG_PATH}: minReleaseAgeDays must be a whole number of days, got ${JSON.stringify(value)}.`,
    );
  }
  if (value < orgFloorDays) {
    throw new UsageError(
      `${CONFIG_PATH}: minReleaseAgeDays of ${value} is below the organisation floor of ${orgFloorDays} days. Repositories may raise the cooldown but not lower it; use the bypass label for one-off emergencies.`,
    );
  }

  return { minReleaseAgeDays: value };
}
