// In-memory, per-process rate limiter -- same trade-off as lib/run-status.ts:
// fine for a single Railway replica, resets on restart/redeploy. A stronger
// limiter (Redis/Upstash) would only matter if this ever ran multiple
// replicas or needed to survive restarts, which a single-freelancer tool on
// one instance doesn't. Used to blunt brute-forcing the shared login
// password (§12) and to cap OpenAI spend from a runaway client/bug (§10 "reasonable API/AI costs").
// ponytail: single Map, no periodic cleanup -- bounded by distinct keys
// (IPs / route names), not request volume, so it won't grow unbounded for
// this app's real traffic. Add eviction if that assumption ever breaks.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Best-effort caller identity for rate-limiting -- Railway/most PaaS set
 *  x-forwarded-for; falls back to a shared bucket if it's absent rather than
 *  throwing, since this is a defense-in-depth guard, not the app's only one. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}
