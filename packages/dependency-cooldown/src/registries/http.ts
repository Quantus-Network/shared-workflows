export interface HttpClient {
  getJson(url: string): Promise<unknown>;
}

/**
 * Registries ask for a contactable User-Agent; crates.io rejects requests
 * without one.
 */
export const USER_AGENT =
  "quantus-dependency-cooldown (+https://github.com/Quantus-Network/shared-workflows)";

/**
 * A deliberately plain client: a non-2xx response fails the run rather than
 * being retried, so a registry outage surfaces as a red check instead of a
 * dependency slipping through unverified.
 */
export function createHttpClient(timeoutMs = 20_000): HttpClient {
  const cache = new Map<string, Promise<unknown>>();

  return {
    getJson(url) {
      const cached = cache.get(url);
      if (cached) {
        return cached;
      }
      const request = (async () => {
        const response = await fetch(url, {
          headers: { accept: "application/json", "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`GET ${url} failed with HTTP ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as unknown;
      })();
      cache.set(url, request);
      return request;
    },
  };
}
