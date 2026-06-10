/**
 * units.ts
 *
 * Unit converter: converts a baseQuantity + unit → grams (or grams-equivalent).
 *
 * Assumptions and design choices:
 *
 * Weight/volume units:
 *   - 'g'   → 1:1 grams
 *   - 'ml'  → 1:1 grams (assumes water-density for liquids such as soy sauce,
 *             broth, lemon juice, oils.  Oils are ~0.92 g/ml but the error vs
 *             rounding in recipe development is negligible; kept at 1 for
 *             simplicity consistent with the per-100g table entries.)
 *   - 'cup' → 240 g (US customary cup, water density)
 *   - 'oz'  → 28.35 g
 *   - 'tbsp'→ 15 g  (US tablespoon, water density)
 *   - 'tsp' → 5 g   (US teaspoon)
 *   - 'pinch' → 0.5 g (trace amount — negligible, included for completeness)
 *   - 'slice' → resolved per ingredient by callers (default 25 g)
 *   - 'clove'→ resolved via gramsPerUnit in the nutrition table (garlic: 3 g/clove)
 *
 * Countable units ('whole', 'clove'):
 *   The nutrition table entry for the ingredient should carry a `gramsPerUnit`
 *   value.  convertToGrams() receives that value as an optional parameter
 *   (passed by computeMacros after the table lookup).  If no gramsPerUnit is
 *   found, a default of 100 g is used and a warning flag is set.
 *
 * Normalisation:
 *   normaliseIngredientName() strips parenthetical qualifiers (e.g. "(5% fat)",
 *   "(diced)", "(low sodium)") and descriptive adjectives so that ingredient
 *   names map to the keys in NUTRITION_TABLE regardless of formatting.
 */

/** Supported unit strings in the recipe data */
export type IngredientUnit =
  | 'g'
  | 'ml'
  | 'whole'
  | 'tsp'
  | 'tbsp'
  | 'pinch'
  | 'cup'
  | 'oz'
  | 'clove'
  | 'slice';

const UNIT_TO_GRAMS: Record<string, number> = {
  g:      1,
  ml:     1,      // water-density assumption (see module header)
  cup:    240,
  oz:     28.35,
  tbsp:   15,
  tsp:    5,
  pinch:  0.5,
  slice:  25,     // default slice weight; overridden by gramsPerUnit lookup
  clove:  3,      // garlic clove default; overridden by gramsPerUnit lookup
};

/**
 * Convert a recipe quantity to grams.
 *
 * @param quantity     - baseQuantity from the recipe ingredient
 * @param unit         - unit string from the recipe ingredient
 * @param gramsPerUnit - optional per-item gram weight from the nutrition table
 *                       (used for 'whole' and 'clove' units)
 * @returns grams (number), or 0 if the unit is unrecognised
 */
export function convertToGrams(
  quantity: number,
  unit: string,
  gramsPerUnit?: number,
): number {
  const normUnit = unit.toLowerCase().trim();

  // Countable units: use the per-item gram weight from the nutrition table
  if (normUnit === 'whole' || normUnit === 'clove') {
    const gpUnit = gramsPerUnit ?? 100; // fallback: 100 g
    return quantity * gpUnit;
  }

  const factor = UNIT_TO_GRAMS[normUnit];
  if (factor === undefined) {
    // Unknown unit — return 0 so the ingredient contributes 0 macros
    return 0;
  }
  return quantity * factor;
}

// ──────────────────────────────────────────────────────────────────────────────
// Normaliser
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Maps raw ingredient name variants to the canonical key used in NUTRITION_TABLE.
 *
 * Strategy (applied in order):
 *  1. Lowercase the entire string.
 *  2. Strip parenthetical qualifiers: "(5% fat)", "(low sodium)", "(diced)" etc.
 *  3. Strip trailing descriptive phrases separated by commas (e.g. ", diced",
 *     ", grated", ", halved"), EXCEPT when the whole key is a compound like
 *     "peas & carrots" (handled via alias map below).
 *  4. Strip common adjective prefixes: "lean", "frozen", "fresh", "canned",
 *     "cooked", "pre-cooked", "low-fat", "light", "reduced-fat", "high-protein".
 *  5. Collapse multiple spaces.
 *  6. Apply explicit alias overrides for compound/ambiguous names.
 */
export function normaliseIngredientName(raw: string): string {
  let s = raw.toLowerCase().trim();

  // Early alias check on the raw lowercased string (before any stripping).
  // This preserves multi-word identifiers like "pre-cooked jasmine rice" that
  // would otherwise be stripped to just "jasmine rice".
  const earlyAlias = ALIAS_MAP[s];
  if (earlyAlias !== undefined) return earlyAlias;

  // Strip parenthetical qualifiers
  s = s.replace(/\s*\([^)]*\)/g, '');

  // Strip trailing descriptive modifiers after a comma
  // e.g. "onion, diced" → "onion", "tuna in water, drained" → "tuna in water"
  // BUT preserve "peas & carrots" style compounds handled below
  s = s.replace(/,\s*(diced|sliced|grated|chopped|minced|halved|shredded|spiralized|thinly sliced|finely diced|roughly chopped|thin strips|cubed|whole|thawed|squeezed|mashed|crumbled|torn|grilled & sliced|baked|ground|coarsely ground|small|peeled & cubed|diced small|diced fine|diced or ground|drained|microwaved|cooked & well-drained|microwaved & squeezed|thawed & squeezed|blended smooth|finely minced or ground|minced fine|thin strips|shredded \(cooked\)|roasted \(jarred ok\)|roasted or jarred|roasted|in water, drained)[^,]*/g, '');

  // Strip leading/trailing whitespace
  s = s.trim();

  // Strip adjective prefixes (order matters — longer ones first)
  const prefixesToStrip = [
    'high-protein ', 'low-fat ', 'low fat ', 'reduced-fat ', 'reduced fat ',
    'pre-cooked ', 'pre cooked ',
    'light ', 'lean ', 'frozen ', 'fresh ',
    'cooked ', 'canned ',
  ];
  for (const prefix of prefixesToStrip) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
    }
  }

  // Strip trailing descriptors like " – cook fresh at eating time" only when
  // preceded by whitespace (to avoid stripping hyphens within compound words like "stir-fry").
  s = s.replace(/\s+[–-].*$/, '').trim();

  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Apply explicit aliases (handles compound names, ambiguous after stripping)
  return ALIAS_MAP[s] ?? s;
}

/**
 * Alias overrides: maps normalised-but-still-ambiguous names to the
 * canonical NUTRITION_TABLE key.
 *
 * NOTE: These aliases are applied AFTER prefix-stripping, so they must cover
 * both the fully-raw form AND the post-strip form.
 */
const ALIAS_MAP: Record<string, string> = {
  // ── Proteins ────────────────────────────────────────────────────────────────
  'ground beef':                      'lean ground beef',
  'ground beef (5% fat)':             'lean ground beef',
  'lean ground beef (5% fat)':        'lean ground beef',
  'beef':                             'lean ground beef',
  'chicken breast':                   'chicken breast',
  'chicken breast (cooked)':          'cooked chicken breast',
  'chicken broth':                    'chicken broth',
  'beef broth':                       'beef broth',
  'tuna in water':                    'canned tuna',
  'tuna in water, drained':           'canned tuna',
  'tuna':                             'canned tuna',
  'tuna in water drained':            'canned tuna',
  'shrimp':                           'shrimp',
  'pre-cooked shrimp':                'shrimp',
  'egg whites':                       'egg white',
  'egg yolks':                        'egg yolk',
  'whole eggs':                       'egg',
  'eggs':                             'egg',
  'egg':                              'egg',
  'egg (for meatballs)':              'egg',
  'beef shin':                        'lean beef shin',
  'beef stew cuts':                   'lean beef stew cuts',
  'ground turkey':                    'lean ground turkey',
  'ground chicken':                   'lean ground chicken',

  // Dairy
  'quark (0.2% fat)':                 'quark',
  'magerquark':                       'quark',
  'greek yogurt':                     'greek yogurt',
  'low-fat greek yogurt':             'greek yogurt',
  'greek yogurt (marinade)':          'greek yogurt',
  'greek yogurt (to serve)':          'greek yogurt',
  'low-fat cottage cheese':           'cottage cheese',
  'low fat cottage cheese':           'cottage cheese',
  'cottage cheese (low fat)':         'cottage cheese',
  'cottage cheese':                   'cottage cheese',
  'cottage cheese blended smooth':    'cottage cheese',
  'reduced-fat feta':                 'feta',
  'feta cheese':                      'feta',
  'reduced-fat mozzarella':           'mozzarella',
  'mozzarella':                       'mozzarella',
  'reduced-fat cheddar':              'cheddar',
  'cheddar':                          'cheddar',
  'vanilla whey protein powder':      'whey protein powder',
  'vanilla protein powder':           'whey protein powder',

  // ── Grains ───────────────────────────────────────────────────────────────────
  // Both pre-strip (with parenthetical) and post-strip forms needed.
  'jasmine rice (dry)':               'jasmine rice',
  'jasmine rice':                     'jasmine rice',
  'pre-cooked jasmine rice (microwave pouch)': 'pre-cooked jasmine rice',
  'pre-cooked jasmine rice pouch':    'pre-cooked jasmine rice',
  'jasmine rice (microwave pouch)':   'pre-cooked jasmine rice',
  'jasmine rice microwave pouch':     'pre-cooked jasmine rice',
  'jasmine rice pouch':               'pre-cooked jasmine rice',
  'cooked jasmine rice (day-old)':    'cooked jasmine rice',
  'cooked jasmine rice':              'cooked jasmine rice',
  'spelt pasta (dinkel-pasta)':       'spelt pasta',
  'spelt pasta':                      'spelt pasta',
  'spelt penne (dinkel-pasta)':       'spelt pasta',
  'spelt penne':                      'spelt pasta',
  'spelt pasta large shells (dinkelconchiglioni)': 'spelt pasta',
  'spelt pasta large shells':         'spelt pasta',
  'spelt pasta (dinkel-pasta, fusilli shape)': 'spelt pasta',
  'spelt pasta (dinkel-pasta, penne)': 'spelt pasta',
  'spelt pasta (dinkel-pasta, rigatoni)': 'spelt pasta',
  'orzo pasta (substitute: small spelt pasta)': 'orzo pasta',
  'orzo pasta':                       'orzo pasta',
  'soba noodles (dry)':               'soba noodles',
  'soba noodles':                     'soba noodles',
  'rolled oats':                      'rolled oats',
  'oat flour':                        'oat flour',
  'oat flour (for meatballs)':        'oat flour',
  'quinoa (dry)':                     'quinoa',
  'quinoa':                           'quinoa',
  'rice cakes':                       'rice cakes',
  'plain rice cakes':                 'rice cakes',
  'rye crispbread':                   'rye crispbread',
  'rye crispbread (knäckebrot)':      'rye crispbread',
  'whole-grain rye bread':            'rye bread',
  'rye bread':                        'rye bread',
  'whole-wheat tortilla (large)':     'whole-wheat tortilla',
  'whole-wheat tortillas (medium)':   'whole-wheat tortilla',
  'whole-wheat tortilla':             'whole-wheat tortilla',
  'whole-wheat tortillas':            'whole-wheat tortilla',
  'whole-wheat flatbread or pitta':   'flatbread',
  'flatbread':                        'flatbread',
  'mini whole-wheat naan':            'naan',
  'naan':                             'naan',
  'red lentils (dry)':                'red lentils',
  'red lentils':                      'red lentils',

  // ── Beans ─────────────────────────────────────────────────────────────────────
  'black beans':                      'black beans',
  'kidney beans':                     'kidney beans',
  'white beans':                      'white beans',
  'pinto beans':                      'pinto beans',
  'chickpeas':                        'chickpeas',
  'edamame':                          'edamame',
  'green peas':                       'green peas',
  'frozen green peas':                'green peas',
  'frozen edamame':                   'edamame',
  'frozen edamame, microwaved':       'edamame',
  'peas & carrots':                   'peas and carrots',
  'frozen peas & carrots':            'peas and carrots',
  'peas and carrots':                 'peas and carrots',

  // ── Vegetables ───────────────────────────────────────────────────────────────
  'onion':                            'onion',
  'onions':                           'onion',
  'red onion':                        'red onion',
  'spring onions':                    'spring onion',
  'spring onion':                     'spring onion',
  'garlic':                           'garlic',
  'garlic cloves':                    'garlic',
  'garlic cloves, minced':            'garlic',
  'garlic cloves, whole':             'garlic',
  'garlic bulb':                      'garlic bulb',
  'garlic bulb, whole':               'garlic bulb',
  'ginger':                           'ginger',
  // Post-strip forms (after prefix "frozen" removed)
  'broccoli florets':                 'frozen broccoli',
  'broccoli':                         'frozen broccoli',
  'frozen broccoli florets':          'frozen broccoli',
  'frozen broccoli':                  'frozen broccoli',
  'spinach':                          'spinach',
  'spinach (fresh or frozen)':        'spinach',
  'frozen spinach':                   'spinach',
  'mixed vegetables':                 'frozen mixed vegetables',
  'frozen mixed vegetables':          'frozen mixed vegetables',
  'stir-fry vegetables':              'stir-fry vegetables',
  'frozen stir-fry vegetables':       'stir-fry vegetables',
  'corn':                             'corn',
  'frozen corn':                      'corn',
  'canned corn':                      'corn',
  'frozen sweetcorn':                 'corn',
  'sweetcorn':                        'corn',
  'corn (frozen or canned)':          'corn',
  'green beans':                      'green beans',
  'frozen green beans':               'green beans',
  'cherry tomatoes':                  'cherry tomatoes',
  // Canned tomatoes — raw forms (prefix "canned" gets stripped)
  'canned crushed tomatoes':          'canned tomatoes',
  'canned diced tomatoes':            'canned tomatoes',
  'crushed tomatoes':                 'canned tomatoes',
  'diced tomatoes':                   'canned tomatoes',
  'tomato passata':                   'tomato passata',
  'tomato paste':                     'tomato paste',
  'red bell pepper':                  'red bell pepper',
  'red bell peppers':                 'red bell pepper',
  'red and yellow bell peppers':      'red bell pepper',
  'red bell peppers (for serving, buy fresh)': 'red bell pepper',
  'red bell peppers, roasted or jarred': 'roasted red pepper',
  'red bell peppers, roasted (jarred ok)': 'roasted red pepper',
  'roasted red pepper (jar)':         'roasted red pepper',
  'roasted red pepper':               'roasted red pepper',
  'cucumber':                         'cucumber',
  'avocado':                          'avocado',
  'courgette':                        'courgette',
  'sweet potato':                     'sweet potato',
  'mixed salad leaves':               'mixed salad leaves',
  'romaine lettuce':                  'romaine lettuce',
  'butter lettuce leaves':            'butter lettuce',
  'water chestnuts':                  'water chestnuts',
  'mushrooms':                        'mushrooms',
  'dried porcini mushrooms':          'dried porcini',
  'dried porcini':                    'dried porcini',
  'carrot':                           'carrot',
  'celery':                           'celery',
  'celery stalks':                    'celery',
  'cabbage leaves (large)':           'cabbage',
  'cabbage leaves':                   'cabbage',
  'cabbage':                          'cabbage',
  'frozen peppers & onions':          'frozen peppers and onions',
  'frozen peppers & onions mix':      'frozen peppers and onions',
  'peppers & onions':                 'frozen peppers and onions',
  'peppers & onions mix':             'frozen peppers and onions',
  // Post-strip (prefix "frozen" removed)
  'capers':                           'capers',
  'frozen mixed berries':             'frozen berries',
  'frozen mixed berries, thawed':     'frozen berries',
  'mixed berries':                    'frozen berries',
  'mixed berries, thawed':            'frozen berries',
  'banana':                           'banana',
  'raisins':                          'raisins',
  'lime juice':                       'lime juice',
  'lemon juice':                      'lemon juice',

  // Fats / nuts
  'olive oil':                        'olive oil',
  'olive oil (for roasting garlic)':  'olive oil',
  'sesame oil':                       'sesame oil',
  'peanut butter (1 tsp)':            'peanut butter',
  'natural peanut butter':            'peanut butter',
  'almonds':                          'almonds',
  'pine nuts':                        'pine nuts',
  'pine nuts (or walnuts)':           'pine nuts',
  'sesame seeds':                     'sesame seeds',
  'chia seeds':                       'chia seeds',
  'kalamata olives':                  'kalamata olives',
  'green olives':                     'green olives',
  'cooking spray':                    'cooking spray',

  // Sauces / condiments
  'soy sauce':                        'soy sauce',
  'soy sauce (low sodium)':           'soy sauce',
  'oyster sauce':                     'oyster sauce',
  'fish sauce':                       'fish sauce',
  'hoisin sauce':                     'hoisin sauce',
  'tomato salsa':                     'tomato salsa',
  'tomato salsa (low sugar)':         'tomato salsa',
  'dijon mustard':                    'dijon mustard',
  'honey':                            'honey',
  'honey (to drizzle)':               'honey',
  'rice vinegar':                     'rice vinegar',
  'apple cider vinegar':              'apple cider vinegar',
  'sriracha sauce':                   'sriracha sauce',
  'balsamic glaze':                   'balsamic glaze',
  'worcestershire sauce':             'worcestershire sauce',
  'red enchilada sauce (jar)':        'red enchilada sauce',
  'light caesar dressing':            'caesar dressing',
  'pesto (light)':                    'pesto',
  'hummus (light)':                   'hummus',
  'chipotle chilli in adobo (1 pepper)': 'chipotle chilli',
  'chipotle chilli in adobo':         'chipotle chilli',
  'vanilla extract':                  'vanilla extract',
  'sundried tomatoes (in water, drained)': 'sundried tomatoes',
  'sundried tomatoes':                'sundried tomatoes',
  'light coconut milk':               'light coconut milk',
  'coconut milk (light)':             'light coconut milk',

  // Broths
  'beef broth (low sodium)':          'beef broth',
  'chicken broth (low sodium)':       'chicken broth',

  // Spices / herbs (measurable quantities)
  'curry powder':                     'curry powder',
  'garam masala':                     'garam masala',
  'tikka masala spice blend':         'tikka masala spice',
  'taco seasoning':                   'taco seasoning',
  'smoked paprika':                   'smoked paprika',
  'paprika':                          'paprika',
  'cumin':                            'cumin',
  'turmeric':                         'turmeric',
  'cinnamon':                         'cinnamon',
  'chilli powder':                    'chilli powder',
  'chilli flakes':                    'chilli flakes',
  'red chilli flakes':                'chilli flakes',
  'red chilli flakes (generous)':     'chilli flakes',
  'dried oregano':                    'dried oregano',
  'dried oregano & chilli flakes':    'dried oregano',
  'dried basil':                      'dried basil',
  'dried thyme':                      'dried thyme',
  'dried dill':                       'dried dill',
  'italian seasoning':                'italian seasoning',
  'oregano':                          'oregano',
  'garlic powder':                    'garlic powder',
  'onion powder':                     'onion powder',
  'coriander (ground)':               'coriander ground',
  'coriander':                        'coriander ground',
  'rosemary, dried':                  'rosemary',
  'dried rosemary':                   'rosemary',
  'thyme, dried':                     'thyme',
  'thyme':                            'thyme',
  'baking powder':                    'baking powder',
  'black pepper, coarsely ground':    'black pepper',
  'fresh thai basil leaves':          'fresh thai basil',
  'fresh basil':                      'fresh basil',
  'fresh basil leaves':               'fresh basil',
  // Post-strip aliases (after prefix "fresh" is removed by the normaliser)
  'basil leaves':                     'fresh basil',
  'basil':                            'fresh basil',
  'thai basil leaves':                'fresh thai basil',
  'thai basil':                       'fresh thai basil',
  'fresh parsley':                    'fresh parsley',
  'parsley':                          'fresh parsley',
  'fresh chives':                     'fresh chives',
  'chives':                           'fresh chives',
  'fresh coriander':                  'fresh coriander',
  'fresh dill':                       'fresh dill',
  'dill':                             'fresh dill',
  'fresh rosemary':                   'fresh rosemary',
  'lemon zest':                       'lemon zest',
  'salt':                             'salt',
  'salt & pepper':                    'salt',
  'nutmeg, pinch':                    'nutmeg',
  'bay leaves':                       'bay leaves',
  'bay leaf':                         'bay leaves',
  'red chilli':                       'chilli flakes',
  'red chilli, sliced':               'chilli flakes',
  'spring onions & sesame seeds':     'spring onions and sesame seeds',

  // Composite / "and" ingredients
  'cumin & turmeric':                 'cumin',   // approximate to cumin (turmeric is minor)
};
