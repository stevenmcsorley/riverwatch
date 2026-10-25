import { createCache } from '../shared/cache.mjs';

export function normalizeRadar(data) {
  const host = new URL(data.host);
  if (host.protocol !== 'https:' || host.hostname !== 'tilecache.rainviewer.com' || host.username || host.password || host.port) throw new Error('Unexpected radar tile host');
  if (!Array.isArray(data.radar?.past)) throw new Error('Missing radar frames');
  const frames = [...new Map(data.radar.past.filter(frame => Number.isFinite(frame.time) && /^\/v2\/radar\/[\w-]+$/.test(frame.path)).map(frame => [frame.path, { path: frame.path, time: frame.time }])).values()]
    .sort((a, b) => a.time - b.time).slice(-13);
  if (!frames.length) throw new Error('No radar frames available');
  return { host: host.origin, frames, generatedAt: data.generated ? new Date(data.generated * 1000).toISOString() : null };
}

export function createRadarFeed(request = fetch) {
  const cache = createCache({ maxEntries: 1 });
  return () => cache.get('radar', 60_000, async () => {
    const response = await request('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Radar feed unavailable');
    return normalizeRadar(await response.json());
  });
}
