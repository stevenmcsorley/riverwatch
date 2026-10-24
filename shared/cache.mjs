// Bound memory use, share concurrent reads, and never retain failed requests.
export function createCache({ maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map(), pending = new Map();
  function peek(key) {
    const entry = entries.get(key);
    if (!entry || entry.expires <= now()) { entries.delete(key); return undefined; }
    entries.delete(key); entries.set(key, entry);
    return entry.value;
  }
  return {
    peek,
    get(key, ttl, loader) {
      const cached = peek(key);
      if (cached !== undefined) return Promise.resolve(cached);
      if (pending.has(key)) return pending.get(key);
      const request = Promise.resolve().then(loader).then(value => {
        entries.set(key, { value, expires: now() + ttl });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
  };
}

export class BoundedMap extends Map {
  constructor(limit = 80) { super(); this.limit = limit; }
  get(key) {
    const value = super.get(key);
    if (value?.expires <= Date.now()) { this.delete(key); return undefined; }
    if (value !== undefined) { this.delete(key); super.set(key, value); }
    return value;
  }
  set(key, value) {
    this.delete(key);
    super.set(key, value);
    while (this.size > this.limit) this.delete(this.keys().next().value);
    return this;
  }
}
