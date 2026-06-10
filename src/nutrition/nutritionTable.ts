/**
 * nutritionTable.ts
 *
 * Curated macronutrient reference values for every ingredient that appears
 * across the 100 HealthTracker recipes.
 *
 * Sources: USDA FoodData Central (SR Legacy / Foundation Foods), BLS
 * Bundeslebensmittelschlüssel (German Federal Nutrient Database), and
 * standard manufacturer/packaging data for processed items.
 *
 * All per100g values satisfy Atwater approximately:
 *   kcal ≈ 4 × protein + 4 × carbs + 9 × fat
 *
 * "Countable" units (whole egg, onion, garlic clove, etc.) express their
 * per-item gram weight via the `gramsPerUnit` field; the unit converter uses
 * that to convert baseQuantity in 'whole' units → grams before looking up
 * per-100g values.
 *
 * Ingredients that are negligible in caloric contribution (salt, pepper,
 * herbs used as garnish, cooking spray, bay leaves, nutmeg pinch) are included
 * with realistic but low values rather than being omitted — this preserves
 * the computation loop and avoids "unmatched" warnings for harmless items.
 */

export interface NutritionPer100g {
  /** kcal per 100 g (or per 100 ml for liquids — density ~1 g/ml assumed) */
  kcal: number;
  /** protein g per 100 g */
  protein: number;
  /** carbohydrate g per 100 g */
  carbs: number;
  /** fat g per 100 g */
  fat: number;
  /**
   * For countable items (unit === 'whole'): grams per single item.
   * undefined for weight/volume measured ingredients.
   */
  gramsPerUnit?: number;
}

/**
 * Main lookup map.  Keys are lowercase, stripped of parenthetical qualifiers
 * and descriptive adjectives.  The `normaliseKey()` function in units.ts
 * transforms raw ingredient names to these keys before lookup.
 */
export const NUTRITION_TABLE: Record<string, NutritionPer100g> = {

  // ── PROTEINS ─────────────────────────────────────────────────────────────────

  // Lean ground beef, 5 % fat (raw weight)
  // USDA #23572 — 80/20 extrapolated to ~95/5
  'lean ground beef': { kcal: 137, protein: 21.0, carbs: 0,    fat: 5.5 },

  // Chicken breast raw (boneless, skinless)
  // USDA #05012
  'chicken breast':   { kcal: 110, protein: 23.0, carbs: 0,    fat: 1.5 },

  // Cooked/grilled chicken breast (slightly denser after moisture loss)
  'cooked chicken breast': { kcal: 165, protein: 31.0, carbs: 0, fat: 3.6 },

  // Lean ground turkey, raw
  // USDA #05165
  'lean ground turkey': { kcal: 130, protein: 19.5, carbs: 0,  fat: 5.5 },

  // Lean ground chicken, raw
  'lean ground chicken': { kcal: 120, protein: 19.0, carbs: 0,  fat: 4.5 },

  // Chicken thighs, skinless, boneless, raw
  // USDA #05027 — significantly more fat than breast
  'chicken thighs':   { kcal: 152, protein: 19.0, carbs: 0,    fat: 8.0 },

  // Lean beef shin / stew cuts (trimmed, raw) — similar to 5 % ground
  'lean beef shin':   { kcal: 135, protein: 21.0, carbs: 0,    fat: 5.2 },
  'lean beef stew cuts': { kcal: 135, protein: 21.0, carbs: 0, fat: 5.2 },

  // Canned tuna in water, drained
  // USDA #15126 — lean, very low fat
  'canned tuna':      { kcal: 116, protein: 25.5, carbs: 0,    fat: 0.9 },

  // Salmon fillet, raw
  // USDA #15076
  'salmon fillet':    { kcal: 208, protein: 20.0, carbs: 0,    fat: 13.0 },

  // Smoked salmon
  // USDA #15086
  'smoked salmon':    { kcal: 117, protein: 18.3, carbs: 0,    fat: 4.3 },

  // Pre-cooked/thawed shrimp
  // USDA #15152 — very lean
  'shrimp':           { kcal: 99,  protein: 21.0, carbs: 0,    fat: 1.0 },

  // Eggs (whole, large ≈ 50 g shelled)
  // USDA #01123
  'egg':              { kcal: 147, protein: 12.6, carbs: 0.7,  fat: 9.9,  gramsPerUnit: 50 },

  // Egg whites only
  // USDA #01124 — 'whole' unit here represents one egg white ≈ 30 g
  'egg white':        { kcal: 52,  protein: 10.9, carbs: 0.7,  fat: 0.2,  gramsPerUnit: 30 },

  // Egg yolks
  // USDA #01125 — 'whole' unit ≈ 17 g per yolk
  'egg yolk':         { kcal: 322, protein: 15.9, carbs: 3.6,  fat: 26.5, gramsPerUnit: 17 },

  // ── DAIRY / DAIRY-ALTERNATIVE PROTEINS ──────────────────────────────────────

  // High-protein quark 0.2 % fat (Magerquark)
  // BLS: ~67 kcal, 12 g P, 4 g C, 0.2 g F per 100 g
  'quark':            { kcal: 67,  protein: 12.0, carbs: 4.0,  fat: 0.2 },

  // Cottage cheese low fat (~2 % fat)
  // USDA #01012
  'cottage cheese':   { kcal: 98,  protein: 11.1, carbs: 3.4,  fat: 4.3 },

  // Low-fat Greek yogurt (~0–2 % fat)
  // USDA #01256 variant
  'greek yogurt':     { kcal: 59,  protein: 10.0, carbs: 3.6,  fat: 0.4 },

  // Skim milk
  // USDA #01079
  'skim milk':        { kcal: 35,  protein: 3.4,  carbs: 5.0,  fat: 0.1 },

  // Ricotta (light / part-skim)
  // USDA #01169
  'ricotta':          { kcal: 138, protein: 9.3,  carbs: 4.9,  fat: 9.5 },

  // Parmesan, grated
  // USDA #01032
  'parmesan':         { kcal: 392, protein: 35.8, carbs: 3.2,  fat: 25.8 },

  // Reduced-fat mozzarella (part-skim)
  // USDA #01026
  'mozzarella':       { kcal: 254, protein: 24.3, carbs: 2.7,  fat: 15.9 },

  // Fresh mozzarella (light) — slightly lower fat than part-skim brick
  'fresh mozzarella': { kcal: 254, protein: 24.3, carbs: 2.7,  fat: 15.9 },

  // Reduced-fat feta (~15 % fat vs ~21 % full-fat)
  // USDA #01019 adjusted
  'feta':             { kcal: 190, protein: 14.2, carbs: 4.1,  fat: 13.0 },

  // Reduced-fat cheddar
  // USDA #01009 adjusted
  'cheddar':          { kcal: 295, protein: 24.9, carbs: 1.3,  fat: 20.0 },

  // Vanilla whey protein powder
  // Typical: ~370 kcal / 80 g P / 8 g C / 4 g F per 100 g
  'whey protein powder': { kcal: 370, protein: 80.0, carbs: 8.0, fat: 4.0 },
  'vanilla protein powder': { kcal: 370, protein: 80.0, carbs: 8.0, fat: 4.0 },

  // ── GRAINS / PASTA / CARB BASES ──────────────────────────────────────────────

  // Jasmine rice, dry uncooked
  // USDA #20444 — standard white rice
  'jasmine rice':     { kcal: 360, protein: 7.0,  carbs: 79.0, fat: 0.6 },

  // Pre-cooked / microwave jasmine rice pouch (cooked weight, ~180 g = 100 g dry equiv.)
  // Cooked white rice is ~130 kcal/100 g
  'pre-cooked jasmine rice': { kcal: 130, protein: 2.7, carbs: 28.0, fat: 0.3 },

  // Cooked jasmine rice (day-old for fried rice)
  'cooked jasmine rice': { kcal: 130, protein: 2.7, carbs: 28.0, fat: 0.3 },

  // Spelt pasta, dry (Dinkel-Pasta)
  // BLS — spelt is slightly higher protein than wheat pasta
  'spelt pasta':      { kcal: 353, protein: 14.0, carbs: 65.0, fat: 2.2 },

  // Orzo pasta (use spelt values as substitute noted)
  'orzo pasta':       { kcal: 353, protein: 14.0, carbs: 65.0, fat: 2.2 },

  // Soba noodles, dry
  // USDA #20129
  'soba noodles':     { kcal: 336, protein: 14.7, carbs: 67.0, fat: 1.0 },

  // Rolled oats (dry)
  // USDA #08120
  'rolled oats':      { kcal: 389, protein: 17.0, carbs: 66.0, fat: 7.0 },

  // Oat flour (dry — same macro profile as rolled oats)
  'oat flour':        { kcal: 389, protein: 17.0, carbs: 66.0, fat: 7.0 },

  // Quinoa, dry
  // USDA #20137
  'quinoa':           { kcal: 368, protein: 14.1, carbs: 64.2, fat: 6.1 },

  // Plain rice cakes — typically one ≈ 9 g
  // USDA #19048
  'rice cakes':       { kcal: 382, protein: 7.3,  carbs: 80.0, fat: 2.9, gramsPerUnit: 9 },

  // Rye crispbread (Knäckebrot) — one piece ≈ 10 g
  // BLS typical values
  'rye crispbread':   { kcal: 344, protein: 9.0,  carbs: 68.0, fat: 2.5, gramsPerUnit: 10 },

  // Whole-grain rye bread — one slice ≈ 33 g
  // USDA #18033
  'rye bread':        { kcal: 259, protein: 8.5,  carbs: 48.0, fat: 3.3, gramsPerUnit: 33 },

  // Whole-wheat tortilla (large, ~45 g each)
  // USDA #18364
  'whole-wheat tortilla': { kcal: 218, protein: 7.4, carbs: 36.0, fat: 5.0, gramsPerUnit: 45 },

  // Whole-wheat flatbread / pitta (~80 g each)
  'flatbread':        { kcal: 263, protein: 9.4,  carbs: 48.0, fat: 3.8, gramsPerUnit: 80 },

  // Mini whole-wheat naan (~70 g each)
  'naan':             { kcal: 287, protein: 8.0,  carbs: 50.0, fat: 6.0, gramsPerUnit: 70 },

  // Whole-wheat tortillas medium (≈ 38 g each)
  'whole-wheat tortillas medium': { kcal: 218, protein: 7.4, carbs: 36.0, fat: 5.0, gramsPerUnit: 38 },

  // Red lentils, dry
  // USDA #16070
  'red lentils':      { kcal: 352, protein: 24.6, carbs: 60.1, fat: 1.1 },

  // ── BEANS / LEGUMES (canned, drained) ────────────────────────────────────────
  // Drained canned beans ≈ ~70 % of the dry weight macro profile,
  // but reference values here are for the drained cooked state.

  // Black beans, canned, drained
  // USDA #16015
  'black beans':      { kcal: 91,  protein: 5.3,  carbs: 16.6, fat: 0.4 },

  // Kidney beans, canned, drained
  // USDA #16033
  'kidney beans':     { kcal: 85,  protein: 5.4,  carbs: 15.4, fat: 0.3 },

  // White beans (cannellini), canned, drained
  // USDA #16182
  'white beans':      { kcal: 89,  protein: 5.6,  carbs: 15.8, fat: 0.3 },

  // Pinto beans, canned, drained
  // USDA #16043
  'pinto beans':      { kcal: 88,  protein: 5.2,  carbs: 16.0, fat: 0.5 },

  // Chickpeas, canned, drained
  // USDA #16057
  'chickpeas':        { kcal: 119, protein: 6.4,  carbs: 19.9, fat: 2.5 },

  // Edamame (frozen, shelled, cooked)
  // USDA #11212
  'edamame':          { kcal: 121, protein: 11.9, carbs: 8.9,  fat: 5.2 },

  // Green peas, frozen
  // USDA #11304
  'green peas':       { kcal: 81,  protein: 5.4,  carbs: 14.5, fat: 0.4 },

  // Peas & carrots, frozen mix
  'peas and carrots': { kcal: 62,  protein: 3.4,  carbs: 11.0, fat: 0.3 },

  // ── VEGETABLES ───────────────────────────────────────────────────────────────

  // Onion (medium ~110 g, large ~150 g — use 120 g as standard)
  // USDA #11282
  'onion':            { kcal: 40,  protein: 1.1,  carbs: 9.3,  fat: 0.1, gramsPerUnit: 120 },

  // Spring onion / green onion (1 stalk ≈ 15 g)
  // USDA #11291
  'spring onion':     { kcal: 32,  protein: 1.8,  carbs: 7.3,  fat: 0.2, gramsPerUnit: 15 },

  // Red onion (same macro profile as yellow)
  'red onion':        { kcal: 40,  protein: 1.1,  carbs: 9.3,  fat: 0.1 },

  // Garlic clove (1 ≈ 3 g peeled)
  // USDA #11215
  'garlic':           { kcal: 149, protein: 6.4,  carbs: 33.1, fat: 0.5, gramsPerUnit: 3 },

  // Ginger, grated (fresh)
  // USDA #11216
  'ginger':           { kcal: 80,  protein: 1.8,  carbs: 17.8, fat: 0.8 },

  // Broccoli, frozen (cooked value; frozen/cooked ≈ raw nutritionally)
  // USDA #11091
  'frozen broccoli':  { kcal: 35,  protein: 2.4,  carbs: 7.2,  fat: 0.4 },

  // Fresh spinach / frozen spinach (squeezed)
  // USDA #11457 — frozen values similar after moisture reduction
  'spinach':          { kcal: 23,  protein: 2.9,  carbs: 3.6,  fat: 0.4 },

  // Frozen mixed vegetables (generic blend: peas, carrots, corn, beans)
  // USDA #11401 composite
  'frozen mixed vegetables': { kcal: 65,  protein: 3.5,  carbs: 13.0, fat: 0.3 },

  // Frozen stir-fry vegetables (similar profile to mixed veg)
  'stir-fry vegetables': { kcal: 55,  protein: 2.8,  carbs: 10.5, fat: 0.3 },

  // Frozen corn / sweetcorn
  // USDA #11168
  'corn':             { kcal: 86,  protein: 3.2,  carbs: 18.7, fat: 1.2 },

  // Frozen green beans
  // USDA #11052
  'green beans':      { kcal: 31,  protein: 1.8,  carbs: 7.1,  fat: 0.1 },

  // Cherry tomatoes
  // USDA #11529
  'cherry tomatoes':  { kcal: 18,  protein: 0.9,  carbs: 3.9,  fat: 0.2 },

  // Canned crushed/diced tomatoes (drained or as-is)
  // USDA #11549
  'canned tomatoes':  { kcal: 24,  protein: 1.1,  carbs: 5.0,  fat: 0.2 },

  // Tomato passata (strained)
  'tomato passata':   { kcal: 24,  protein: 1.1,  carbs: 5.0,  fat: 0.2 },

  // Tomato paste (concentrated ~3× regular)
  // USDA #11546
  'tomato paste':     { kcal: 82,  protein: 4.3,  carbs: 18.9, fat: 0.5 },

  // Red bell pepper (1 medium ≈ 150 g)
  // USDA #11821
  'red bell pepper':  { kcal: 31,  protein: 1.0,  carbs: 6.0,  fat: 0.3, gramsPerUnit: 150 },

  // Cucumber (raw)
  // USDA #11206
  'cucumber':         { kcal: 15,  protein: 0.7,  carbs: 3.6,  fat: 0.1 },

  // Avocado (1 whole ≈ 150 g flesh; ½ ≈ 75 g; ¼ ≈ 37.5 g)
  // USDA #09037 — fresh, Hass
  'avocado':          { kcal: 160, protein: 2.0,  carbs: 8.5,  fat: 14.7, gramsPerUnit: 150 },

  // Courgette / zucchini
  // USDA #11477
  'courgette':        { kcal: 17,  protein: 1.2,  carbs: 3.1,  fat: 0.3 },

  // Sweet potato
  // USDA #11507
  'sweet potato':     { kcal: 86,  protein: 1.6,  carbs: 20.1, fat: 0.1 },

  // Mixed salad leaves
  // USDA #11251 (romaine)
  'mixed salad leaves': { kcal: 17, protein: 1.2, carbs: 3.3,  fat: 0.3 },

  // Romaine lettuce
  'romaine lettuce':  { kcal: 17,  protein: 1.2,  carbs: 3.3,  fat: 0.3 },

  // Butter lettuce leaves (1 leaf ≈ 15 g)
  // USDA #11251
  'butter lettuce':   { kcal: 13,  protein: 1.4,  carbs: 2.2,  fat: 0.2, gramsPerUnit: 15 },

  // Water chestnuts, canned, drained
  // USDA #11685
  'water chestnuts':  { kcal: 76,  protein: 1.4,  carbs: 18.0, fat: 0.1 },

  // Mushrooms (fresh, sliced) including porcini
  // USDA #11260
  'mushrooms':        { kcal: 22,  protein: 3.1,  carbs: 3.3,  fat: 0.3 },

  // Dried porcini mushrooms (concentrated — much more caloric)
  // Typical dried mushroom: ~280 kcal / 30 g P / 55 g C / 3 g F per 100 g
  'dried porcini':    { kcal: 280, protein: 30.0, carbs: 55.0, fat: 3.0 },

  // Carrot (1 medium ≈ 80 g)
  // USDA #11124
  'carrot':           { kcal: 41,  protein: 0.9,  carbs: 9.6,  fat: 0.2, gramsPerUnit: 80 },

  // Celery stalk (1 stalk ≈ 40 g)
  // USDA #11143
  'celery':           { kcal: 16,  protein: 0.7,  carbs: 3.0,  fat: 0.2, gramsPerUnit: 40 },

  // Cabbage leaf (1 large leaf ≈ 50 g)
  // USDA #11109
  'cabbage':          { kcal: 25,  protein: 1.3,  carbs: 5.8,  fat: 0.1, gramsPerUnit: 50 },

  // Frozen peppers & onions mix
  'frozen peppers and onions': { kcal: 35, protein: 1.0, carbs: 8.0, fat: 0.2 },

  // Frozen berries (mixed)
  // USDA composite ~50 kcal / 100 g
  'frozen berries':   { kcal: 50,  protein: 0.7,  carbs: 12.0, fat: 0.3 },

  // ── FRUITS ───────────────────────────────────────────────────────────────────

  // Banana (medium ≈ 120 g)
  // USDA #09040
  'banana':           { kcal: 89,  protein: 1.1,  carbs: 23.0, fat: 0.3 },

  // Raisins
  // USDA #09298
  'raisins':          { kcal: 299, protein: 3.1,  carbs: 79.2, fat: 0.5 },

  // Lime juice
  // USDA #09160 — negligible macros at amounts used
  'lime juice':       { kcal: 25,  protein: 0.4,  carbs: 8.4,  fat: 0.1 },

  // Lemon juice
  // USDA #09152
  'lemon juice':      { kcal: 22,  protein: 0.4,  carbs: 6.9,  fat: 0.2 },

  // ── FATS / OILS ──────────────────────────────────────────────────────────────

  // Olive oil
  // USDA #04053
  'olive oil':        { kcal: 884, protein: 0,    carbs: 0,    fat: 100 },

  // Sesame oil
  // USDA #04058
  'sesame oil':       { kcal: 884, protein: 0,    carbs: 0,    fat: 100 },

  // Natural peanut butter
  // USDA #16098
  'peanut butter':    { kcal: 598, protein: 25.1, carbs: 20.1, fat: 51.4 },

  // Almonds
  // USDA #12061
  'almonds':          { kcal: 579, protein: 21.2, carbs: 21.7, fat: 49.9 },

  // Pine nuts
  // USDA #12147
  'pine nuts':        { kcal: 673, protein: 13.7, carbs: 13.1, fat: 68.4 },

  // Sesame seeds
  // USDA #12023
  'sesame seeds':     { kcal: 573, protein: 17.7, carbs: 23.5, fat: 49.7 },

  // Chia seeds
  // USDA #12006
  'chia seeds':       { kcal: 486, protein: 16.5, carbs: 42.1, fat: 30.7 },

  // Kalamata olives
  // USDA #09193 — brine-cured
  'kalamata olives':  { kcal: 115, protein: 0.8,  carbs: 6.3,  fat: 10.7 },

  // Green olives
  'green olives':     { kcal: 115, protein: 0.8,  carbs: 3.8,  fat: 10.7 },

  // Cooking spray — essentially oil but used in very small amounts (≈1–2 g)
  'cooking spray':    { kcal: 884, protein: 0,    carbs: 0,    fat: 100 },

  // Capers (brined) — USDA #11742
  'capers':           { kcal: 23,  protein: 2.4,  carbs: 4.9,  fat: 0.9 },

  // ── SAUCES / CONDIMENTS ───────────────────────────────────────────────────────

  // Soy sauce (low sodium) — mostly sodium, very few calories
  // USDA #16124
  'soy sauce':        { kcal: 53,  protein: 8.1,  carbs: 4.9,  fat: 0.6 },

  // Oyster sauce
  // USDA #16126
  'oyster sauce':     { kcal: 105, protein: 2.5,  carbs: 22.7, fat: 0.3 },

  // Fish sauce
  // USDA #04592
  'fish sauce':       { kcal: 35,  protein: 5.1,  carbs: 3.6,  fat: 0.0 },

  // Hoisin sauce
  // USDA #16038
  'hoisin sauce':     { kcal: 220, protein: 3.8,  carbs: 41.4, fat: 4.5 },

  // Tomato salsa
  // ~40 kcal / 100 g typical commercial salsa
  'tomato salsa':     { kcal: 40,  protein: 1.5,  carbs: 8.0,  fat: 0.5 },

  // Dijon mustard
  // USDA #02046
  'dijon mustard':    { kcal: 66,  protein: 3.7,  carbs: 5.8,  fat: 3.3 },

  // Honey
  // USDA #19296
  'honey':            { kcal: 304, protein: 0.3,  carbs: 82.4, fat: 0 },

  // Rice vinegar
  // USDA #02048 — essentially zero macros
  'rice vinegar':     { kcal: 18,  protein: 0,    carbs: 0.04, fat: 0 },

  // Apple cider vinegar — negligible
  'apple cider vinegar': { kcal: 22, protein: 0,  carbs: 0.9,  fat: 0 },

  // Sriracha sauce
  // Typical ~93 kcal / 100 g
  'sriracha sauce':   { kcal: 93,  protein: 1.0,  carbs: 20.0, fat: 0.5 },

  // Balsamic glaze (reduced)
  // ~256 kcal / 100 g — concentrated sugars
  'balsamic glaze':   { kcal: 256, protein: 0.5,  carbs: 62.0, fat: 0 },

  // Worcestershire sauce
  // USDA #02033
  'worcestershire sauce': { kcal: 78, protein: 0, carbs: 18.0, fat: 0 },

  // Red enchilada sauce (jar)
  // Typical ~40 kcal / 100 g
  'red enchilada sauce': { kcal: 40, protein: 1.0, carbs: 7.0, fat: 1.0 },

  // Light Caesar dressing
  // Typical light Caesar ~200 kcal / 100 g
  'caesar dressing':  { kcal: 200, protein: 2.0,  carbs: 10.0, fat: 17.0 },

  // Light pesto
  // USDA #06164 typical basil pesto (light: ~250 kcal vs 400 full-fat)
  'pesto':            { kcal: 250, protein: 5.0,  carbs: 7.0,  fat: 23.0 },

  // Hummus (light)
  // Typical light hummus ~120 kcal / 100 g
  'hummus':           { kcal: 120, protein: 5.0,  carbs: 12.0, fat: 6.0 },

  // Chipotle chilli in adobo
  // ~80 kcal / 100 g
  'chipotle chilli':  { kcal: 80,  protein: 2.5,  carbs: 14.5, fat: 2.5 },

  // Vanilla extract
  // ~288 kcal / 100 ml — but amounts used are negligible (1–2 ml)
  'vanilla extract':  { kcal: 288, protein: 0.1,  carbs: 12.7, fat: 0.1 },

  // Roasted red peppers (jar) — similar to fresh when drained
  'roasted red pepper': { kcal: 31, protein: 1.0, carbs: 6.0, fat: 0.3 },

  // Sundried tomatoes (water-packed, drained) — much more concentrated than fresh
  // ~258 kcal / 100 g
  'sundried tomatoes': { kcal: 258, protein: 14.1, carbs: 55.8, fat: 3.0 },

  // Light coconut milk
  // USDA #12116 light variant ~135 kcal / 100 ml
  'light coconut milk': { kcal: 135, protein: 1.5, carbs: 3.4, fat: 13.0 },

  // Coconut milk (light) — same entry
  'coconut milk':     { kcal: 135, protein: 1.5,  carbs: 3.4,  fat: 13.0 },

  // Beef broth, low sodium
  // ~5 kcal / 100 ml — essentially water
  'beef broth':       { kcal: 8,   protein: 1.1,  carbs: 0.6,  fat: 0.2 },

  // Chicken broth, low sodium
  // ~10 kcal / 100 ml
  'chicken broth':    { kcal: 10,  protein: 1.7,  carbs: 0.3,  fat: 0.2 },

  // Vegetable broth
  // ~8 kcal / 100 ml
  'vegetable broth':  { kcal: 8,   protein: 0.4,  carbs: 1.4,  fat: 0.2 },

  // ── HERBS AND SPICES (used in measurable amounts) ────────────────────────────
  // These contribute minimal calories at culinary quantities but are included
  // for completeness of the computation loop.

  'curry powder':     { kcal: 325, protein: 14.3, carbs: 55.8, fat: 14.0 },
  'garam masala':     { kcal: 379, protein: 11.0, carbs: 66.0, fat: 12.0 },
  'tikka masala spice': { kcal: 345, protein: 11.0, carbs: 58.0, fat: 11.0 },
  'taco seasoning':   { kcal: 280, protein: 8.5,  carbs: 55.0, fat: 6.0 },
  'smoked paprika':   { kcal: 282, protein: 14.1, carbs: 54.0, fat: 13.0 },
  'paprika':          { kcal: 282, protein: 14.1, carbs: 54.0, fat: 13.0 },
  'cumin':            { kcal: 375, protein: 17.8, carbs: 44.2, fat: 22.3 },
  'turmeric':         { kcal: 354, protein: 7.8,  carbs: 64.9, fat: 9.9 },
  'cinnamon':         { kcal: 247, protein: 4.0,  carbs: 80.6, fat: 1.2 },
  'chilli powder':    { kcal: 282, protein: 12.0, carbs: 55.0, fat: 14.0 },
  'chilli flakes':    { kcal: 282, protein: 12.0, carbs: 55.0, fat: 14.0 },
  'dried oregano':    { kcal: 265, protein: 9.0,  carbs: 68.9, fat: 4.3 },
  'dried basil':      { kcal: 233, protein: 22.8, carbs: 47.8, fat: 4.0 },
  'dried thyme':      { kcal: 276, protein: 9.1,  carbs: 63.9, fat: 7.4 },
  'dried dill':       { kcal: 253, protein: 19.9, carbs: 55.8, fat: 4.4 },
  'italian seasoning': { kcal: 265, protein: 9.0, carbs: 68.9, fat: 4.3 },
  'oregano':          { kcal: 265, protein: 9.0,  carbs: 68.9, fat: 4.3 },
  'garlic powder':    { kcal: 331, protein: 16.6, carbs: 72.7, fat: 0.7 },
  'onion powder':     { kcal: 341, protein: 10.4, carbs: 79.1, fat: 1.0 },
  'coriander ground': { kcal: 298, protein: 12.4, carbs: 55.0, fat: 17.8 },
  'rosemary':         { kcal: 131, protein: 3.3,  carbs: 20.7, fat: 5.9 },
  'thyme':            { kcal: 101, protein: 5.6,  carbs: 24.5, fat: 1.7 },
  'baking powder':    { kcal: 53,  protein: 0,    carbs: 27.7, fat: 0 },
  'black pepper':     { kcal: 251, protein: 10.4, carbs: 63.9, fat: 3.3 },

  // Fresh herbs — very small amounts, negligible calories
  'fresh basil':      { kcal: 23,  protein: 3.2,  carbs: 2.7,  fat: 0.6 },
  'fresh thai basil': { kcal: 23,  protein: 3.2,  carbs: 2.7,  fat: 0.6 },
  'fresh parsley':    { kcal: 36,  protein: 3.0,  carbs: 6.3,  fat: 0.8 },
  'fresh chives':     { kcal: 30,  protein: 3.3,  carbs: 4.4,  fat: 0.7 },
  'fresh coriander':  { kcal: 23,  protein: 2.1,  carbs: 3.7,  fat: 0.5 },
  'fresh dill':       { kcal: 43,  protein: 3.5,  carbs: 7.0,  fat: 1.1 },
  'fresh rosemary':   { kcal: 131, protein: 3.3,  carbs: 20.7, fat: 5.9 },
  'lemon zest':       { kcal: 47,  protein: 1.5,  carbs: 16.0, fat: 0.3 },

  // Salt / salt & pepper — essentially zero calories; included to avoid unmatched warning
  'salt':             { kcal: 0,   protein: 0,    carbs: 0,    fat: 0 },

  // Nutmeg — used in pinch amounts only
  'nutmeg':           { kcal: 525, protein: 5.8,  carbs: 49.3, fat: 36.3 },

  // Bay leaves (whole, removed before eating) — treat as zero
  'bay leaves':       { kcal: 0,   protein: 0,    carbs: 0,    fat: 0, gramsPerUnit: 1 },

  // Spring onions & sesame seeds (composite ingredient)
  // Use half sesame seeds / half spring onion profile
  'spring onions and sesame seeds': { kcal: 300, protein: 9.8, carbs: 15.4, fat: 25.0 },

  // Garlic bulb (whole roasted) — treated same as garlic cloves but one whole
  // bulb ≈ 40 g of cloves
  'garlic bulb':      { kcal: 149, protein: 6.4,  carbs: 33.1, fat: 0.5, gramsPerUnit: 40 },
};
