import { parseRecipeHtml, RecipeDraft } from '../recipeHtml';

function block(data: unknown, attrs = 'type="application/ld+json"'): string {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return `<script ${attrs}>${body}</script>`;
}

function page(...blocks: string[]): string {
  return `<html><head><title>x</title>${blocks.join('\n')}</head><body><p>hi</p></body></html>`;
}

function draftOf(html: string): RecipeDraft {
  const result = parseRecipeHtml(html);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected a draft');
  return result.draft;
}

const RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Hackbraten',
  recipeIngredient: ['500 g Hackfleisch', '1 EL Olivenöl', '1 Prise Salz'],
  recipeInstructions: 'Mischen.\nBacken.',
  recipeYield: '4 Portionen',
  totalTime: 'PT1H30M',
};

describe('parseRecipeHtml', () => {
  describe('finding the recipe', () => {
    it('maps a plain recipe block', () => {
      expect(draftOf(page(block(RECIPE)))).toEqual({
        title: 'Hackbraten',
        servings: 4,
        prepMinutes: 90,
        ingredients: [
          { name: 'Hackfleisch', quantity: 500, unit: 'g' },
          { name: 'Olivenöl', quantity: 15, unit: 'g' },
          { name: '1 Prise Salz', quantity: 0, unit: 'g' },
        ],
        instructions: 'Mischen.\nBacken.',
      });
    });

    it.each([
      ['uppercase tag and attribute', `<SCRIPT TYPE="APPLICATION/LD+JSON">`],
      ['single quotes', `<script type='application/ld+json'>`],
      ['no quotes', `<script type=application/ld+json>`],
      ['charset suffix', `<script type="application/ld+json; charset=utf-8">`],
      ['attribute after', `<script type="application/ld+json" id="seo">`],
      ['attribute before', `<script id="seo" data-x="1" type="application/ld+json">`],
    ])('accepts %s', (_label, open) => {
      const html = `<html>${open}${JSON.stringify(RECIPE)}</script></html>`;
      expect(draftOf(html).title).toBe('Hackbraten');
    });

    it('ignores scripts that are not ld+json', () => {
      const html = `<script type="text/javascript">${JSON.stringify(RECIPE)}</script>` +
        `<script data-type="application/ld+json">${JSON.stringify(RECIPE)}</script>`;
      expect(parseRecipeHtml(html)).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('finds a recipe inside @graph', () => {
      const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, RECIPE] };
      expect(draftOf(page(block(graph))).title).toBe('Hackbraten');
    });

    it('finds a recipe in a top-level array', () => {
      expect(draftOf(page(block([{ '@type': 'Person' }, RECIPE]))).title).toBe('Hackbraten');
    });

    it('finds a recipe nested as an object value', () => {
      const wrapper = { '@type': 'WebPage', mainEntity: RECIPE };
      expect(draftOf(page(block(wrapper))).title).toBe('Hackbraten');
    });

    it.each([
      [['Thing', 'Recipe']],
      ['https://schema.org/Recipe'],
      ['Recipe'],
    ])('accepts @type %j', (type) => {
      expect(draftOf(page(block({ ...RECIPE, '@type': type }))).title).toBe('Hackbraten');
    });

    it('takes the first recipe when there are several', () => {
      const second = { ...RECIPE, name: 'Second' };
      expect(draftOf(page(block({ ...RECIPE, name: 'First' }), block(second))).title).toBe('First');
      expect(draftOf(page(block([{ ...RECIPE, name: 'First' }, second]))).title).toBe('First');
    });

    it('skips a block with bad JSON and still reads the next', () => {
      expect(draftOf(page(block('{"@type": "Recipe", name:'), block(RECIPE))).title).toBe('Hackbraten');
    });

    it('survives a closing script tag inside a string and reads the next block', () => {
      const broken = block('{"@type":"Recipe","name":"a</script>b"}');
      const html = page(broken, block(RECIPE));
      expect(draftOf(html).title).toBe('Hackbraten');
    });

    it('reads at most 50 blocks', () => {
      const junk = Array.from({ length: 50 }, () => block({ '@type': 'Thing' }));
      expect(parseRecipeHtml(page(...junk, block(RECIPE)))).toEqual({ ok: false, reason: 'no-recipe' });
      expect(draftOf(page(...junk.slice(1), block(RECIPE))).title).toBe('Hackbraten');
    });

    it('skips a block larger than 1 MB', () => {
      const big = { ...RECIPE, description: 'x'.repeat(1_100_000) };
      expect(parseRecipeHtml(page(block(big)))).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns no-recipe for a page without scripts', () => {
      expect(parseRecipeHtml('<html><body>nothing</body></html>')).toEqual({ ok: false, reason: 'no-recipe' });
      expect(parseRecipeHtml('')).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns no-recipe for an unclosed script', () => {
      const html = `<script type="application/ld+json">${JSON.stringify(RECIPE)}`;
      expect(parseRecipeHtml(html)).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns no-recipe when the recipe has nothing readable', () => {
      expect(parseRecipeHtml(page(block({ '@type': 'Recipe' })))).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('finds a recipe a few levels deep but not 50 levels deep', () => {
      let shallow: unknown = RECIPE;
      for (let i = 0; i < 3; i++) shallow = { '@graph': [shallow] };
      expect(draftOf(page(block(shallow))).title).toBe('Hackbraten');

      let deep: unknown = RECIPE;
      for (let i = 0; i < 50; i++) deep = { '@graph': [deep] };
      expect(parseRecipeHtml(page(block(deep)))).toEqual({ ok: false, reason: 'no-recipe' });
    });
  });

  describe('instructions', () => {
    it('reads HowToStep text, falling back to name', () => {
      const recipe = {
        ...RECIPE,
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Zwiebeln schneiden' },
          { '@type': 'HowToStep', name: 'Anbraten' },
          'Servieren',
        ],
      };
      expect(draftOf(page(block(recipe))).instructions).toBe('Zwiebeln schneiden\nAnbraten\nServieren');
    });

    it('flattens HowToSection in order', () => {
      const recipe = {
        ...RECIPE,
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            name: 'Teig',
            itemListElement: [
              { '@type': 'HowToStep', text: 'Mehl sieben' },
              { '@type': 'HowToStep', text: 'Kneten' },
            ],
          },
          { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Backen' }] },
        ],
      };
      expect(draftOf(page(block(recipe))).instructions).toBe('Mehl sieben\nKneten\nBacken');
    });

    it('caps the step count, step length and total length', () => {
      const many = { ...RECIPE, recipeInstructions: Array.from({ length: 200 }, (_, i) => `step ${i}`) };
      expect(draftOf(page(block(many))).instructions.split('\n')).toHaveLength(60);

      const long = { ...RECIPE, recipeInstructions: ['y'.repeat(5000)] };
      expect(draftOf(page(block(long))).instructions).toHaveLength(1000);

      const huge = { ...RECIPE, recipeInstructions: Array.from({ length: 60 }, () => 'z'.repeat(900)) };
      expect(draftOf(page(block(huge))).instructions.length).toBeLessThanOrEqual(20000);
    });
  });

  describe('servings and time', () => {
    const servings = (value: unknown) => draftOf(page(block({ ...RECIPE, recipeYield: value }))).servings;

    it.each([
      [6, 6],
      ['6', 6],
      ['Serves 4-6', 4],
      [['8 Stück', '4'], 8],
      [[6], 6],
      [0, null],
      [100, null],
      ['viele', null],
      [[], null],
      [{ a: 1 }, null],
      [undefined, null],
    ])('yield %j gives %j', (value, expected) => {
      expect(servings(value)).toBe(expected);
    });

    const minutes = (extra: Record<string, unknown>) =>
      draftOf(page(block({ ...RECIPE, totalTime: undefined, ...extra }))).prepMinutes;

    it.each([
      ['PT45M', 45],
      ['PT1H', 60],
      ['PT1H30M', 90],
      ['P0DT2H', 120],
      ['pt20m', 20],
      ['PT30S', 1],
      ['PT61S', 2],
      ['P1D', 1440],
      ['P1DT1H', null],
      ['PT0M', null],
      ['P', null],
      ['abc', null],
      ['PT99999999999999999999H', null],
    ])('totalTime %s gives %j', (value, expected) => {
      expect(minutes({ totalTime: value })).toBe(expected);
    });

    it('uses prepTime when totalTime is missing or unreadable', () => {
      expect(minutes({ prepTime: 'PT15M' })).toBe(15);
      expect(minutes({ totalTime: 'soon', prepTime: 'PT15M' })).toBe(15);
      expect(minutes({ totalTime: 'PT20M', prepTime: 'PT15M' })).toBe(20);
    });
  });

  describe('untrusted values', () => {
    it('strips tags and decodes entities', () => {
      const recipe = {
        ...RECIPE,
        name: '<b>Mac &amp; Cheese</b> &#39;n&#x27; &quot;Co&quot; &lt;3&nbsp;&gt;',
        recipeIngredient: ['<a href="javascript:alert(1)">200 g</a> Mehl&nbsp;'],
      };
      const draft = draftOf(page(block(recipe)));
      expect(draft.title).toBe(`Mac & Cheese 'n' "Co" <3 >`);
      expect(draft.ingredients[0]).toEqual({ name: 'Mehl', quantity: 200, unit: 'g' });
    });

    it('decodes each entity once', () => {
      const draft = draftOf(page(block({ ...RECIPE, name: '&amp;lt;b&amp;gt;' })));
      expect(draft.title).toBe('&lt;b&gt;');
    });

    it('removes control and direction characters and collapses whitespace', () => {
      const name = 'A\u0000B‮C​   D\n\tE&#0;F';
      expect(draftOf(page(block({ ...RECIPE, name }))).title).toBe('ABC D EF');
    });

    it('drops values that are not strings', () => {
      const recipe = {
        ...RECIPE,
        name: { text: 'x' },
        recipeIngredient: ['200 g Mehl', 5, null, { a: 1 }, ['x'], true],
        recipeInstructions: 42,
      };
      const draft = draftOf(page(block(recipe)));
      expect(draft.title).toBe('');
      expect(draft.ingredients).toEqual([{ name: 'Mehl', quantity: 200, unit: 'g' }]);
      expect(draft.instructions).toBe('');
    });

    it('never reads a __proto__ key and leaves Object.prototype alone', () => {
      const poisoned = '{"__proto__":{"@type":"Recipe","name":"evil","recipeIngredient":["1 kg Gift"]}}';
      expect(parseRecipeHtml(page(block(poisoned)))).toEqual({ ok: false, reason: 'no-recipe' });

      const nested = '{"@graph":[{"constructor":{"@type":"Recipe","name":"evil2"}},{"prototype":{"@type":"Recipe","name":"evil3"}}]}';
      expect(parseRecipeHtml(page(block(nested)))).toEqual({ ok: false, reason: 'no-recipe' });

      const inRecipe = `{"@type":"Recipe","name":"ok","__proto__":{"name":"evil","polluted":"yes"}}`;
      expect(draftOf(page(block(inRecipe))).title).toBe('ok');

      const probe: Record<string, unknown> = {};
      expect(probe.polluted).toBeUndefined();
      expect(probe.name).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    });

    it('truncates huge strings', () => {
      const recipe = {
        ...RECIPE,
        name: 'n'.repeat(900_000),
        recipeIngredient: ['i'.repeat(900_000)],
      };
      const draft = draftOf(page(block(recipe)));
      expect(draft.title).toHaveLength(120);
      expect(draft.ingredients).toHaveLength(1);
      expect(draft.ingredients[0].name.length).toBeLessThanOrEqual(200);
    });

    it('keeps at most 60 ingredients', () => {
      const recipe = { ...RECIPE, recipeIngredient: Array.from({ length: 100_000 }, () => '1 g x') };
      expect(draftOf(page(block(recipe))).ingredients).toHaveLength(60);
    });

    it('stops walking a 100000-element array and reports no recipe', () => {
      const filler = Array.from({ length: 100_000 }, () => 1);
      const started = Date.now();
      const result = parseRecipeHtml(page(block([...filler, RECIPE])));
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('does not slow down on a long run of angle brackets in a field', () => {
      const started = Date.now();
      const draft = draftOf(page(block({ ...RECIPE, name: '<'.repeat(900_000) })));
      expect(typeof draft.title).toBe('string');
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe('hostile pages', () => {
    const UNCLOSED = '<script type="application/ld+json">';
    const SIZE = 3_000_000;
    const repeated = UNCLOSED.repeat(Math.ceil(SIZE / UNCLOSED.length)).slice(0, SIZE);

    it('returns no-recipe quickly for 3 MB of unclosed script tags', () => {
      const started = Date.now();
      const result = parseRecipeHtml(repeated);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns no-recipe quickly when one closed block follows 3 MB of unclosed tags, because the first tag swallows everything up to the only closing tag and that block is over 1 MB', () => {
      const started = Date.now();
      const result = parseRecipeHtml(repeated + block(RECIPE));
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns quickly for 3 MB of script openings without a tag end', () => {
      const started = Date.now();
      const result = parseRecipeHtml('<script '.repeat(375_000));
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns quickly for many openings with one tag end at the very end', () => {
      const started = Date.now();
      const result = parseRecipeHtml('<script '.repeat(375_000) + '>');
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('returns quickly for 3 MB of less-than signs', () => {
      const started = Date.now();
      const result = parseRecipeHtml('<'.repeat(SIZE));
      expect(Date.now() - started).toBeLessThan(1000);
      expect(result).toEqual({ ok: false, reason: 'no-recipe' });
    });

    it('never throws on non-string input', () => {
      expect(parseRecipeHtml(undefined as unknown as string)).toEqual({ ok: false, reason: 'no-recipe' });
      expect(parseRecipeHtml(null as unknown as string)).toEqual({ ok: false, reason: 'no-recipe' });
    });
  });
});
