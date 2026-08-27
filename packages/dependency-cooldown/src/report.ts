import type { Finding } from "./policy.js";
import { REGISTRIES } from "./registries/index.js";
import type { UncheckableDependency } from "./types.js";

export interface ReportInput {
  mode: "check" | "audit";
  minReleaseAgeDays: number;
  checkedCount: number;
  violations: readonly Finding[];
  uncheckable: readonly UncheckableDependency[];
  bypassReason: string | null;
  bypassLabel: string;
}

function releaseDate(finding: Finding): string {
  return finding.publishedAt.toISOString().slice(0, 10);
}

function daysToWait(finding: Finding, minReleaseAgeDays: number): number {
  return Math.max(1, minReleaseAgeDays - finding.ageDays);
}

export function violationMessage(finding: Finding, minReleaseAgeDays: number): string {
  const { dependency, ageDays } = finding;
  return (
    `${dependency.name}@${dependency.version} was published ${ageDays} day(s) ago (${releaseDate(finding)}), ` +
    `less than the required ${minReleaseAgeDays} day cooldown. ` +
    `Wait ${daysToWait(finding, minReleaseAgeDays)} more day(s), pick an older version, or request an emergency bypass.`
  );
}

function findingsTable(findings: readonly Finding[], minReleaseAgeDays: number): string {
  const rows = findings.map((finding) => {
    const registry = REGISTRIES[finding.dependency.registry];
    const url = registry.versionUrl(finding.dependency.name, finding.dependency.version);
    return `| [${finding.dependency.name}](${url}) | \`${finding.dependency.version}\` | ${registry.displayName} | ${releaseDate(finding)} | ${finding.ageDays} | ${daysToWait(finding, minReleaseAgeDays)} | \`${finding.dependency.lockfile}\` |`;
  });
  return [
    "| Package | Version | Registry | Published | Age (days) | Days left | Lockfile |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function uncheckableTable(entries: readonly UncheckableDependency[]): string {
  const rows = entries.map(
    (entry) =>
      `| ${entry.name} | ${entry.version ?? "—"} | ${entry.reason} | \`${entry.lockfile}\` |`,
  );
  return [
    "| Package | Version | Why | Lockfile |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export function renderSummary(input: ReportInput): string {
  const {
    mode,
    minReleaseAgeDays,
    checkedCount,
    violations,
    uncheckable,
    bypassReason,
    bypassLabel,
  } = input;
  const heading = mode === "check" ? "Dependency cooldown" : "Dependency cooldown audit";
  const lines: string[] = [`## ${heading}`, ""];

  const subject =
    mode === "check"
      ? `${checkedCount} newly introduced dependency version(s)`
      : `${checkedCount} dependency version(s) currently locked`;
  lines.push(`Minimum release age: **${minReleaseAgeDays} days**. Checked ${subject}.`, "");

  if (violations.length === 0) {
    lines.push("No dependency is newer than the cooldown window.");
  } else if (bypassReason !== null) {
    lines.push(
      `> [!WARNING]`,
      `> **Cooldown bypassed** via the \`${bypassLabel}\` label.`,
      `> Reason: ${bypassReason}`,
      "",
      `${violations.length} dependency version(s) below the cooldown were allowed through:`,
      "",
      findingsTable(violations, minReleaseAgeDays),
    );
  } else if (mode === "audit") {
    lines.push(
      `${violations.length} locked dependency version(s) are newer than ${minReleaseAgeDays} days. This audit does not block anything; it exists so the org can see its exposure.`,
      "",
      findingsTable(violations, minReleaseAgeDays),
    );
  } else {
    lines.push(
      `${violations.length} dependency version(s) are newer than the ${minReleaseAgeDays} day cooldown:`,
      "",
      findingsTable(violations, minReleaseAgeDays),
      "",
      "### How to resolve",
      "",
      "1. Preferred: wait out the cooldown, or pin a version that is already older than the cooldown.",
      `2. Emergency only: apply the \`${bypassLabel}\` label and add a \`Cooldown-bypass-reason:\` line to the pull request description.`,
    );
  }

  if (uncheckable.length > 0) {
    lines.push(
      "",
      "<details><summary>",
      `${uncheckable.length} dependency entr(ies) could not be age-checked</summary>`,
      "",
      "These come from git, path or workspace sources rather than a supported registry, so no publish date exists. Review them by hand.",
      "",
      uncheckableTable(uncheckable),
      "",
      "</details>",
    );
  }

  return lines.join("\n");
}
