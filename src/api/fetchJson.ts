/**
 * fetchJson.ts
 *
 * Shared fetch helper for src/api/** clients (TheMealDB, Open Food Facts).
 *
 * Every network call in this app talks to a keyless public API with no
 * guaranteed uptime or latency — a bare `fetch` can hang indefinitely on a
 * stalled connection, taking a screen's loading state down with it. This
 * wraps `fetch` with:
 *   - a manual timeout, built from `setTimeout` + `AbortController` (not
 *     `AbortSignal.timeout`/`AbortSignal.any` — neither is reliably
 *     available under Hermes)
 *   - one retry, 1s later, for transient failures only: a thrown network
 *     error, our own timeout abort, or a `status >= 500` — never a 4xx,
 *     including 429
 *   - an optional external `AbortSignal` so a caller can cancel in flight —
 *     during either a fetch attempt or the retry backoff between attempts;
 *     an external abort rejects immediately and is never retried
 *   - `res.ok` checked before `.json()` is ever called, and a readable
 *     `FetchJsonError` (carrying the HTTP status when there is one) instead
 *     of a raw `TypeError` or a bare `SyntaxError` from a malformed body
 *
 * No new dependency — built-in `fetch` / `AbortController` only.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const RETRY_DELAY_MS = 1000;

export class FetchJsonError extends Error {
  /** HTTP status code, when the failure came from a non-2xx response. */
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FetchJsonError';
    this.status = status;
  }
}

export interface FetchJsonOptions {
  /** Abort (and, on the first attempt, retry) after this many ms. Default 8000. */
  timeoutMs?: number;
  /** Number of retries after the first attempt. Default 1. */
  retries?: number;
  /** External abort signal. An abort here rejects immediately and is never retried. */
  signal?: AbortSignal;
}

/** Internal marker: this attempt was aborted by the caller's own signal. */
class ExternalAbortError extends Error {
  constructor() {
    super('Request aborted');
    this.name = 'ExternalAbortError';
  }
}

/** Internal marker: this attempt was aborted by our own timeout. */
class TimeoutAbortError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutAbortError';
  }
}

/**
 * Wait `ms`, unless `externalSignal` aborts first — in which case reject
 * immediately with `ExternalAbortError` instead of waiting out the delay.
 * Always clears its timer and listener on the way out.
 */
function delay(ms: number, externalSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      reject(new ExternalAbortError());
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new ExternalAbortError());
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    externalSignal?.addEventListener('abort', onAbort);
  });
}

/**
 * The retry backoff, but an external abort during the wait rejects
 * immediately as the same `FetchJsonError('Request aborted')` used for
 * every other external-abort path — never as a bare `ExternalAbortError`,
 * and never followed by another attempt.
 */
async function retryDelay(externalSignal?: AbortSignal): Promise<void> {
  try {
    await delay(RETRY_DELAY_MS, externalSignal);
  } catch (err) {
    if (err instanceof ExternalAbortError) {
      throw new FetchJsonError('Request aborted');
    }
    throw err;
  }
}

/**
 * A single fetch attempt with a manual timeout, wired to an optional
 * external signal. Always clears its timer and listener on the way out —
 * whichever way the attempt ends — so nothing leaks.
 */
async function attemptFetch(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  if (externalSignal?.aborted) {
    throw new ExternalAbortError();
  }

  const controller = new AbortController();
  // Whichever of these fires first "wins" — that's the reason we report if
  // fetch throws. (An external abort always calls controller.abort() too,
  // so we can't tell them apart from the AbortError alone.)
  let reason: 'timeout' | 'external' | null = null;

  const onExternalAbort = () => {
    if (reason === null) reason = 'external';
    controller.abort();
  };
  externalSignal?.addEventListener('abort', onExternalAbort);

  const timer = setTimeout(() => {
    if (reason === null) reason = 'timeout';
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (reason === 'external') throw new ExternalAbortError();
    if (reason === 'timeout') throw new TimeoutAbortError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Fetch `url` and parse the response as JSON, with a timeout, one retry for
 * transient failures, and an optional external abort signal.
 *
 * Throws `FetchJsonError` on: a non-2xx response (before the body is ever
 * parsed, status attached), a JSON-parse failure, an external abort, or a
 * timeout / network error once retries are exhausted.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, signal } = options;

  let attempt = 0;
  for (;;) {
    try {
      const res = await attemptFetch(url, timeoutMs, signal);

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          attempt++;
          await retryDelay(signal);
          continue;
        }
        throw new FetchJsonError(`Request failed with status ${res.status}`, res.status);
      }

      try {
        return (await res.json()) as T;
      } catch (parseErr) {
        throw new FetchJsonError(
          `Failed to parse JSON response: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        );
      }
    } catch (err) {
      if (err instanceof FetchJsonError) {
        throw err; // 4xx, exhausted 5xx retries, or a JSON-parse failure — never retried
      }
      if (err instanceof ExternalAbortError) {
        throw new FetchJsonError('Request aborted'); // never retried
      }
      // A thrown network error or our own timeout abort — retry once.
      if (attempt < retries) {
        attempt++;
        await retryDelay(signal);
        continue;
      }
      throw new FetchJsonError(
        err instanceof TimeoutAbortError
          ? err.message
          : `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
