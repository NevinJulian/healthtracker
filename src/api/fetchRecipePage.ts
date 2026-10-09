import { RecipeDraft } from './recipeHtml';

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

export async function fetchRecipePage(_url: string, _signal?: AbortSignal): Promise<RecipeDraft> {
  throw new RecipePageError('network');
}
