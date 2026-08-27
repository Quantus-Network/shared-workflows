import { REGISTRIES } from "./registries/index.js";
import type { HttpClient } from "./registries/http.js";
import type { DatedDependency } from "./policy.js";
import type { LockedDependency } from "./types.js";

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Looks up the publish date of every dependency. Any lookup failure rejects:
 * an unverifiable dependency must not be reported as compliant.
 */
export async function resolvePublishDates(
  dependencies: readonly LockedDependency[],
  http: HttpClient,
): Promise<DatedDependency[]> {
  const byRegistry = new Map<string, LockedDependency[]>();
  for (const dependency of dependencies) {
    const bucket = byRegistry.get(dependency.registry);
    if (bucket) {
      bucket.push(dependency);
    } else {
      byRegistry.set(dependency.registry, [dependency]);
    }
  }

  const perRegistry = await Promise.all(
    [...byRegistry.entries()].map(async ([registryId, bucket]) => {
      const registry = REGISTRIES[registryId as keyof typeof REGISTRIES];
      return mapWithConcurrency(bucket, registry.maxConcurrency, async (dependency) => ({
        dependency,
        publishedAt: await registry.fetchPublishedAt(dependency.name, dependency.version, http),
      }));
    }),
  );

  return perRegistry.flat();
}
