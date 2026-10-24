import { createCache } from '../shared/cache.mjs';
const cache = createCache({ maxEntries: 60 });
export const cachedData = url => cache.peek(url);
export function loadData(url, ttl = 60_000) {
  return cache.get(url, ttl, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Data request returned ${response.status}`);
    return response.json();
  });
}
