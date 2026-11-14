import { parseIngredientLine } from '../nutrition/parseIngredientLine';

export interface RecipeDraftIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface RecipeDraft {
  title: string;
  servings: number | null;
  prepMinutes: number | null;
  ingredients: RecipeDraftIngredient[];
  instructions: string;
}

export type RecipeHtmlResult =
  | { ok: true; draft: RecipeDraft }
  | { ok: false; reason: 'no-recipe' };

const NO_RECIPE: RecipeHtmlResult = { ok: false, reason: 'no-recipe' };

const MAX_BLOCKS = 50;
const MAX_BLOCK_CHARS = 1_000_000;
const MAX_ATTR_CHARS = 1000;
const MAX_DEPTH = 6;
const MAX_NODES = 2000;
const MAX_TITLE = 120;
const MAX_INGREDIENTS = 60;
const MAX_INGREDIENT = 200;
const MAX_STEPS = 60;
const MAX_STEP = 1000;
const MAX_INSTRUCTIONS = 20000;
const MAX_SECTION_DEPTH = 4;
const MAX_DURATION_CHARS = 50;
const MAX_MINUTES = 1440;
const MAX_SERVINGS = 99;

const SKIPPED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LD_JSON_TYPE = /(?:^|\s)type\s*=\s*["']?application\/ld\+json/;
const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi;
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
const DURATION = /^P(?:(\d{1,6})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,6})M)?(?:(\d{1,9}(?:\.\d+)?)S)?)?$/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function own(node: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(node, key)
    ? (node as Record<string, unknown>)[key]
    : undefined;
}

function stripTags(text: string): string {
  let out = '';
  let from = 0;
  while (from < text.length) {
    const lt = text.indexOf('<', from);
    if (lt < 0) break;
    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) break;
    out += text.slice(from, lt) + ' ';
    from = gt + 1;
  }
  return out + text.slice(from);
}

function decodeEntity(_match: string, body: string): string {
  const lower = body.toLowerCase();
  if (lower.charAt(0) !== '#') return NAMED_ENTITIES[lower] ?? '';
  const code = lower.charAt(1) === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
  if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
  return String.fromCodePoint(code);
}

function clean(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const bounded = value.slice(0, maxLength * 4);
  return stripTags(bounded)
    .replace(ENTITY, decodeEntity)
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function findScriptBlocks(html: string): string[] {
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const blocks: string[] = [];
  let pos = 0;
  let tagEnd = -1;
  let closeAt = -1;

  while (blocks.length < MAX_BLOCKS) {
    const open = lower.indexOf('<script', pos);
    if (open < 0) break;
    const nameEnd = open + '<script'.length;
    const next = lower.charAt(nameEnd);
    if (next !== '' && next !== '>' && next !== '/' && !/\s/.test(next)) {
      pos = nameEnd;
      continue;
    }

    if (tagEnd < nameEnd) {
      tagEnd = lower.indexOf('>', nameEnd);
      if (tagEnd < 0) break;
    }
    if (tagEnd - nameEnd > MAX_ATTR_CHARS) {
      pos = nameEnd;
      continue;
    }

    const bodyStart = tagEnd + 1;
    if (closeAt < bodyStart) {
      closeAt = lower.indexOf('</script', bodyStart);
      if (closeAt < 0) break;
    }

    if (
      closeAt - bodyStart <= MAX_BLOCK_CHARS &&
      LD_JSON_TYPE.test(lower.slice(nameEnd, tagEnd))
    ) {
      blocks.push(html.slice(bodyStart, closeAt));
    }
    pos = closeAt + '</script'.length;
  }
  return blocks;
}

function isRecipeType(type: unknown): boolean {
  const matches = (t: unknown) =>
    typeof t === 'string' && (t === 'Recipe' || t.endsWith('/Recipe') || t.endsWith(':Recipe'));
  return Array.isArray(type) ? type.some(matches) : matches(type);
}

function findRecipe(root: unknown): object | null {
  let budget = MAX_NODES;

  const visit = (value: unknown, depth: number): object | null => {
    if (budget <= 0 || depth > MAX_DEPTH) return null;
    budget--;
    if (typeof value !== 'object' || value === null) return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (budget <= 0) return null;
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (isRecipeType(own(value, '@type'))) return value;
    for (const key of Object.keys(value)) {
      if (budget <= 0) return null;
      if (SKIPPED_KEYS.has(key)) continue;
      const found = visit(own(value, key), depth + 1);
      if (found) return found;
    }
    return null;
  };

  return visit(root, 0);
}

function collectSteps(value: unknown, out: string[], depth: number): void {
  if (out.length >= MAX_STEPS || depth > MAX_SECTION_DEPTH) return;
  if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) {
      if (out.length >= MAX_STEPS) return;
      const step = clean(line, MAX_STEP);
      if (step !== '') out.push(step);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (out.length >= MAX_STEPS) return;
      collectSteps(item, out, depth + 1);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const items = own(value, 'itemListElement');
  if (items !== undefined) {
    collectSteps(items, out, depth + 1);
    return;
  }
  const text = clean(own(value, 'text'), MAX_STEP);
  const step = text !== '' ? text : clean(own(value, 'name'), MAX_STEP);
  if (step !== '') out.push(step);
}

function readInstructions(recipe: object): string {
  const steps: string[] = [];
  collectSteps(own(recipe, 'recipeInstructions'), steps, 0);
  return steps.join('\n').slice(0, MAX_INSTRUCTIONS);
}

function readIngredients(recipe: object): RecipeDraftIngredient[] {
  const raw = own(recipe, 'recipeIngredient');
  const lines = Array.isArray(raw) ? raw : [raw];
  const out: RecipeDraftIngredient[] = [];
  for (const entry of lines) {
    if (out.length >= MAX_INGREDIENTS) break;
    const line = clean(entry, MAX_INGREDIENT);
    if (line === '') continue;
    const parsed = parseIngredientLine(line);
    const name = clean(parsed.name, MAX_INGREDIENT);
    if (name === '') continue;
    out.push({ name, quantity: parsed.quantity, unit: parsed.unit });
  }
  return out;
}

function readServings(recipe: object): number | null {
  const raw = own(recipe, 'recipeYield');
  const entries = Array.isArray(raw) ? raw : [raw];
  const first = entries.find((e) => typeof e === 'number' || typeof e === 'string');
  if (first === undefined) return null;
  const digits = /\d+/.exec(String(first).slice(0, 100));
  if (!digits) return null;
  const n = Number(digits[0]);
  return n >= 1 && n <= MAX_SERVINGS ? n : null;
}

function durationToMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > MAX_DURATION_CHARS) return null;
  const m = DURATION.exec(value.trim());
  if (!m) return null;
  const minutes =
    Number(m[1] ?? 0) * 24 * 60 +
    Number(m[2] ?? 0) * 60 +
    Number(m[3] ?? 0) +
    Math.ceil(Number(m[4] ?? 0) / 60);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null;
}

function readMinutes(recipe: object): number | null {
  return durationToMinutes(own(recipe, 'totalTime')) ?? durationToMinutes(own(recipe, 'prepTime'));
}

function toDraft(recipe: object): RecipeDraft | null {
  const draft: RecipeDraft = {
    title: clean(own(recipe, 'name'), MAX_TITLE),
    servings: readServings(recipe),
    prepMinutes: readMinutes(recipe),
    ingredients: readIngredients(recipe),
    instructions: readInstructions(recipe),
  };
  const empty = draft.title === '' && draft.ingredients.length === 0 && draft.instructions === '';
  return empty ? null : draft;
}

export function parseRecipeHtml(html: string): RecipeHtmlResult {
  try {
    if (typeof html !== 'string') return NO_RECIPE;
    for (const text of findScriptBlocks(html)) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const recipe = findRecipe(data);
      if (!recipe) continue;
      const draft = toDraft(recipe);
      if (draft) return { ok: true, draft };
    }
    return NO_RECIPE;
  } catch {
    return NO_RECIPE;
  }
}
