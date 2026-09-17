/**
 * In-memory sliding-window rate limiter (SPEC §13 — per-instance in-memory is
 * acceptable at this scale; the app runs as a single Railway container).
 */

type Window = { timestamps: number[] };

const buckets = new Map<string, Window>();

// Named limits from SPEC §13.
export const LIMITS = {
  presign: { max: 40, windowMs: 60 * 60 * 1000 }, // 40/hour per IP
  submission: { max: 10, windowMs: 60 * 60 * 1000 }, // 10/hour per IP
  tokenLookup: { max: 30, windowMs: 60 * 1000 }, // 30/min per IP
  login: { max: 5, windowMs: 15 * 60 * 1000 }, // 5/15min per (IP, email)
  reviewResponse: { max: 20, windowMs: 60 * 60 * 1000 }, // 20/hour per IP
} as const;

export type LimitName = keyof typeof LIMITS;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Record one hit against `key` under the named limit and report whether it is
 * allowed. Keys should include the limit name plus identifying context, e.g.
 * `login:1.2.3.4:alex@example.org`.
 */
export function rateLimit(
  name: LimitName,
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  const { max, windowMs } = LIMITS[name];
  const fullKey = `${name}:${key}`;
  const bucket = buckets.get(fullKey) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => t > now - windowMs);

  if (bucket.timestamps.length >= max) {
    buckets.set(fullKey, bucket);
    const oldest = bucket.timestamps[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.timestamps.push(now);
  buckets.set(fullKey, bucket);

  // Opportunistic cleanup so the map can't grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.timestamps.every((t) => t <= now - windowMs)) buckets.delete(k);
    }
  }

  return { allowed: true };
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
