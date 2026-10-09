import { expo } from '../../app.json';
import { parseRecipeHtml, RecipeDraft } from './recipeHtml';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;

const PAGE_HEADERS = {
  Accept: 'text/html',
  'User-Agent': `HealthTracker/${expo.version} (https://github.com/NevinJulian/healthtracker)`,
};

export type RecipePageErrorCode =
  | 'bad-url'
  | 'timeout'
  | 'network'
  | 'http'
  | 'not-html'
  | 'too-large'
  | 'no-recipe'
  | 'aborted';

function messageFor(code: RecipePageErrorCode, status?: number): string {
  switch (code) {
    case 'bad-url':
      return 'Enter a full web address starting with http:// or https://.';
    case 'timeout':
      return 'The page took too long to respond.';
    case 'network':
      return "Couldn't reach that page. Check the address and your connection.";
    case 'http':
      return `The page returned an error (HTTP ${status ?? 0}).`;
    case 'not-html':
      return "That address isn't a web page.";
    case 'too-large':
      return 'That page is too large to import.';
    case 'no-recipe':
      return 'This page has no recipe data the app can read.';
    case 'aborted':
      return 'Request aborted';
  }
}

export class RecipePageError extends Error {
  readonly code: RecipePageErrorCode;
  readonly status?: number;

  constructor(code: RecipePageErrorCode, status?: number) {
    super(messageFor(code, status));
    this.name = 'RecipePageError';
    this.code = code;
    this.status = status;
  }
}

function checkScheme(raw: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '' || /\s/.test(trimmed)) throw new RecipePageError('bad-url');
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    throw new RecipePageError('bad-url');
  }
  if (protocol !== 'http:' && protocol !== 'https:') throw new RecipePageError('bad-url');
  return trimmed;
}

async function readBody(res: Response, aborted: Promise<never>): Promise<string> {
  if (!res.body) {
    const text = await Promise.race([res.text(), aborted]);
    if (text.length > MAX_BYTES) throw new RecipePageError('too-large');
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        finished = true;
        break;
      }
      total += value.byteLength;
      if (total > MAX_BYTES) throw new RecipePageError('too-large');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    if (!finished) {
      try {
        void Promise.resolve(reader.cancel()).catch(() => undefined);
      } catch {
        // the stream is already unusable
      }
    }
  }
}

export async function fetchRecipePage(rawUrl: string, signal?: AbortSignal): Promise<RecipeDraft> {
  const url = checkScheme(rawUrl);
  if (signal?.aborted) throw new RecipePageError('aborted');

  const controller = new AbortController();
  let reason: 'timeout' | 'external' | null = null;
  const onExternalAbort = () => {
    if (reason === null) reason = 'external';
    controller.abort();
  };
  signal?.addEventListener('abort', onExternalAbort);
  const timer = setTimeout(() => {
    if (reason === null) reason = 'timeout';
    controller.abort();
  }, TIMEOUT_MS);

  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  aborted.catch(() => undefined);

  try {
    const res = await Promise.race([
      fetch(url, { signal: controller.signal, headers: PAGE_HEADERS, credentials: 'omit' }),
      aborted,
    ]);
    if (res.url) checkScheme(res.url);
    if (!res.ok) throw new RecipePageError('http', res.status);
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().includes('html')) {
      throw new RecipePageError('not-html');
    }
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) throw new RecipePageError('too-large');

    const html = await readBody(res, aborted);
    const parsed = parseRecipeHtml(html);
    if (!parsed.ok) throw new RecipePageError('no-recipe');
    return parsed.draft;
  } catch (err) {
    if (reason === 'external') throw new RecipePageError('aborted');
    if (reason === 'timeout') throw new RecipePageError('timeout');
    if (err instanceof RecipePageError) throw err;
    throw new RecipePageError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
  }
}
