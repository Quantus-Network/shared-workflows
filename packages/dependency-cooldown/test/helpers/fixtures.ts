import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readFixture(relativePath: string): string {
  const url = new URL(`../fixtures/${relativePath}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}
