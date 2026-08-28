import { REGISTRIES } from "./registries/index.js";
import type { HttpClient } from "./registries/http.js";
import type { DatedDependency } from "./policy.js";
import type { LockedDependency } from "./types.js";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Returns a gate that spaces invocations so a new one cannot start until
 * `minIntervalMs` has passed since the previous invocation was admitted.
 * Reservations are taken before sleeping so concurrent waiters do not share a slot.
 */
function createStartGate(minIntervalMs: number, clock: Clock): () => Promise<void> {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error(
      `minRequestIntervalMs must be a non-negative number, got ${String(minIntervalMs)}.`,
    );
  }
  let nextAllowedAt = 0;
  return async () => {
    if (minIntervalMs === 0) {
      return;
    }
    const t = clock.now();
    const wait = nextAllowedAt - t;
    nextAllowedAt = Math.max(nextAllowedAt, t) + minIntervalMs;
    if (wait > 0) {
      await clock.sleep(wait);
    }
  };
}

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
  clock: Clock = systemClock,
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
      const waitForSlot = createStartGate(registry.minRequestIntervalMs, clock);
      return mapWithConcurrency(bucket, registry.maxConcurrency, async (dependency) => {
        await waitForSlot();
        return {
          dependency,
          publishedAt: await registry.fetchPublishedAt(dependency.name, dependency.version, http),
        };
      });
    }),
  );

  return perRegistry.flat();
}
