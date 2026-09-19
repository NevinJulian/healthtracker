/**
 * Unit tests for fetchJson.ts (issue #318).
 *
 * Covers the acceptance criteria that mealdb.test.ts doesn't exercise
 * directly: 4xx vs 5xx retry behaviour, res.ok checked before .json(),
 * a readable error on JSON-parse failure, and a prompt, non-retried
 * rejection on an external abort.
 */

import { fetchJson, FetchJsonError } from '../fetchJson';

describe('fetchJson (#318)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('resolves with the parsed JSON body on a 2xx response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://example.com/ok')).resolves.toEqual({ hello: 'world' });
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('throws before calling .json() on a non-2xx response, with the status attached', async () => {
    const json = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json,
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://example.com/missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx response, including 429', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://example.com/rate-limited')).rejects.toBeInstanceOf(
      FetchJsonError,
    );
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('retries a 5xx response exactly once', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    jest.useFakeTimers();
    const promise = fetchJson('https://example.com/flaky');
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });

    await jest.advanceTimersByTimeAsync(2000);
    await assertion;

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('retries a thrown network error exactly once, then throws a readable error', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    jest.useFakeTimers();
    const promise = fetchJson('https://example.com/unreachable');
    const assertion = expect(promise).rejects.toMatchObject({
      message: expect.stringContaining('Network request failed'),
    });

    await jest.advanceTimersByTimeAsync(2000);
    await assertion;

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it('throws a readable error when the response body is not valid JSON', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token in JSON');
      },
    })) as unknown as typeof fetch;

    await expect(fetchJson('https://example.com/bad-json')).rejects.toMatchObject({
      message: expect.stringContaining('Failed to parse JSON'),
    });
    // A JSON-parse failure is not a network/5xx failure — not retried.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('rejects promptly and does not retry when the external signal is already aborted', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('should not be called');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchJson('https://example.com/cancelled', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(FetchJsonError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects promptly and does not retry when the external signal aborts mid-flight', async () => {
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = fetchJson('https://example.com/slow', {
      signal: controller.signal,
      timeoutMs: 8000,
    });

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(FetchJsonError);
    // One attempt only — an external abort is never retried.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('rejects promptly (no full retry) when the external signal aborts during the retry backoff', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    jest.useFakeTimers();
    const controller = new AbortController();
    const promise = fetchJson('https://example.com/unreachable', { signal: controller.signal });

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // First attempt fails immediately and enters the ~1000ms retry backoff.
    await jest.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    // Abort 10ms into the backoff — well before the 1000ms delay elapses.
    controller.abort();

    // A couple more ms should be enough for the abort to be noticed; the
    // bug lets the bare setTimeout backoff run all the way to ~1000ms
    // regardless, so this catches it well before that.
    await jest.advanceTimersByTimeAsync(5);
    expect(settled).toBe(true);

    await expect(promise).rejects.toBeInstanceOf(FetchJsonError);
    // Aborted during backoff — no second attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears its timeout timer so a completed request leaves no open handle', async () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await fetchJson('https://example.com/ok');

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
