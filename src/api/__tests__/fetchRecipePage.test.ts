import { fetchRecipePage, RecipePageError } from '../fetchRecipePage';

const MAX_BYTES = 3_000_000;

const RECIPE_HTML =
  '<html><script type="application/ld+json">' +
  JSON.stringify({
    '@type': 'Recipe',
    name: 'Pasta',
    recipeIngredient: ['200 g Nudeln'],
    recipeInstructions: 'Kochen.',
  }) +
  '</script></html>';

interface FakeOptions {
  status?: number;
  url?: string;
  contentType?: string | null;
  contentLength?: number;
  chunks?: Uint8Array[];
  text?: string;
  hangOnRead?: boolean;
}

function fakeResponse(options: FakeOptions = {}) {
  const { status = 200, url = 'https://example.com/r', contentType = 'text/html; charset=utf-8' } = options;
  const headers: Record<string, string> = {};
  if (contentType !== null) headers['content-type'] = contentType;
  if (options.contentLength !== undefined) headers['content-length'] = String(options.contentLength);

  const cancel = jest.fn().mockResolvedValue(undefined);
  const chunks = [...(options.chunks ?? [])];
  const read = jest.fn(() => {
    if (options.hangOnRead) return new Promise<never>(() => {});
    const next = chunks.shift();
    return Promise.resolve(next ? { done: false, value: next } : { done: true, value: undefined });
  });
  const response = {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: options.chunks || options.hangOnRead ? { getReader: () => ({ read, cancel }) } : undefined,
    text: jest.fn().mockResolvedValue(options.text ?? ''),
  };
  return { response, read, cancel };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('fetchRecipePage', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  async function failure(promise: Promise<unknown>): Promise<RecipePageError> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(RecipePageError);
      return err as RecipePageError;
    }
    throw new Error('expected a RecipePageError');
  }

  describe('the address', () => {
    it.each([
      ['ftp://example.com/r'],
      [''],
      ['   '],
      ['example.com/recipe'],
      ['localhost:3000/r'],
      ['javascript:alert(1)'],
      ['file:///etc/passwd'],
      ['https://exa mple.com/r'],
      ['not a url'],
    ])('rejects %j before any request', async (input) => {
      const err = await failure(fetchRecipePage(input));
      expect(err.code).toBe('bad-url');
      expect(err.message).toBe('Enter a full web address starting with http:// or https://.');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('trims the address and requests it with the page headers', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ chunks: [bytes(RECIPE_HTML)] }).response);
      await fetchRecipePage('  http://example.com/r  ');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://example.com/r');
      expect(init.headers.Accept).toBe('text/html');
      expect(init.headers['User-Agent']).toMatch(/^HealthTracker\//);
      expect(init.signal).toBeDefined();
    });

    it('rejects a redirect that ends on another scheme', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ url: 'ftp://example.com/r', chunks: [bytes(RECIPE_HTML)] }).response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('bad-url');
    });
  });

  describe('the response', () => {
    it('returns the draft of a page with a recipe', async () => {
      const { response } = fakeResponse({ chunks: [bytes(RECIPE_HTML.slice(0, 40)), bytes(RECIPE_HTML.slice(40))] });
      fetchMock.mockResolvedValue(response);
      const draft = await fetchRecipePage('https://example.com/r');
      expect(draft.title).toBe('Pasta');
      expect(draft.ingredients).toEqual([{ name: 'Nudeln', quantity: 200, unit: 'g' }]);
    });

    it('keeps a multi-byte character split across two chunks', async () => {
      const html = RECIPE_HTML.replace('Pasta', 'Käse');
      const all = bytes(html);
      const cut = all.indexOf(0xc3) + 1;
      fetchMock.mockResolvedValue(fakeResponse({ chunks: [all.slice(0, cut), all.slice(cut)] }).response);
      expect((await fetchRecipePage('https://example.com/r')).title).toBe('Käse');
    });

    it('reads text() when the response has no body stream', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ text: RECIPE_HTML }).response);
      expect((await fetchRecipePage('https://example.com/r')).title).toBe('Pasta');
    });

    it('rejects text() longer than the limit when there is no body stream', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ text: 'a'.repeat(MAX_BYTES + 1) }).response);
      expect((await failure(fetchRecipePage('https://example.com/r'))).code).toBe('too-large');
    });

    it('reports the real status for a non-2xx response', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 404, chunks: [bytes(RECIPE_HTML)] }).response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('http');
      expect(err.message).toBe('The page returned an error (HTTP 404).');
    });

    it.each([['text/plain'], ['application/json'], [null]])('rejects content type %j', async (contentType) => {
      fetchMock.mockResolvedValue(fakeResponse({ contentType, chunks: [bytes(RECIPE_HTML)] }).response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('not-html');
      expect(err.message).toBe("That address isn't a web page.");
    });

    it('accepts application/xhtml+xml', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ contentType: 'application/xhtml+xml', chunks: [bytes(RECIPE_HTML)] }).response,
      );
      expect((await fetchRecipePage('https://example.com/r')).title).toBe('Pasta');
    });

    it('rejects a 4 MB Content-Length without reading the body', async () => {
      const { response, read } = fakeResponse({ contentLength: 4_000_000, chunks: [bytes(RECIPE_HTML)] });
      fetchMock.mockResolvedValue(response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('too-large');
      expect(err.message).toBe('That page is too large to import.');
      expect(read).not.toHaveBeenCalled();
    });

    it('stops and cancels the reader once a streamed body passes the limit', async () => {
      const chunk = new Uint8Array(1_000_000).fill(97);
      const { response, read, cancel } = fakeResponse({ chunks: [chunk, chunk, chunk, chunk, chunk] });
      fetchMock.mockResolvedValue(response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('too-large');
      expect(cancel).toHaveBeenCalled();
      expect(read.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('reports no-recipe for a page without recipe data', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ chunks: [bytes('<html><body>news</body></html>')] }).response);
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('no-recipe');
      expect(err.message).toBe('This page has no recipe data the app can read.');
    });
  });

  describe('failures on the way', () => {
    it('maps a thrown fetch error to network without retrying', async () => {
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));
      const err = await failure(fetchRecipePage('https://example.com/r'));
      expect(err.code).toBe('network');
      expect(err.message).toBe("Couldn't reach that page. Check the address and your connection.");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out after 15 seconds while waiting for the response', async () => {
      jest.useFakeTimers();
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      });
      const pending = failure(fetchRecipePage('https://example.com/r'));
      await jest.advanceTimersByTimeAsync(14_999);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const err = await pending;
      expect(err.code).toBe('timeout');
      expect(err.message).toBe('The page took too long to respond.');
      expect(signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out while the body never arrives', async () => {
      jest.useFakeTimers();
      const { response, cancel } = fakeResponse({ hangOnRead: true });
      fetchMock.mockResolvedValue(response);
      const pending = failure(fetchRecipePage('https://example.com/r'));
      await jest.advanceTimersByTimeAsync(15_000);
      expect((await pending).code).toBe('timeout');
      expect(cancel).toHaveBeenCalled();
    });

    it('aborts on the caller signal with a single request', async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      });
      const controller = new AbortController();
      const pending = failure(fetchRecipePage('https://example.com/r', controller.signal));
      await Promise.resolve();
      controller.abort();
      const err = await pending;
      expect(err.code).toBe('aborted');
      expect(signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not request anything for an already-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const err = await failure(fetchRecipePage('https://example.com/r', controller.signal));
      expect(err.code).toBe('aborted');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts while the body is being read', async () => {
      const { response, cancel } = fakeResponse({ hangOnRead: true });
      fetchMock.mockResolvedValue(response);
      const controller = new AbortController();
      const pending = failure(fetchRecipePage('https://example.com/r', controller.signal));
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort();
      expect((await pending).code).toBe('aborted');
      expect(cancel).toHaveBeenCalled();
    });
  });
});
