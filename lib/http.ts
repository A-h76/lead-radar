// Small fetch wrapper adding a request timeout (Node's fetch has no default
// one) and a bounded retry for transient failures -- shared by every
// outbound call this app makes server-side (Airtable, OpenAI, Google).
// Deliberately not a queue/backoff library: this app makes at most a
// handful of outbound calls per user action, not a batch pipeline (that
// reliability need is already met on the n8n side via retryOnFail -- see
// n8n/README.md).
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 15000, retries = 1 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      // Only retry on 5xx / network errors -- a 4xx is a real error (bad
      // input, bad auth) retrying can't fix, and shouldn't be repeated
      // against paid APIs (OpenAI) or an account that could get rate-limited.
      if (res.status >= 500 && attempt < retries) continue;
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed.");
}
