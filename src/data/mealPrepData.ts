/**
 * Static meal prep data — bi-weekly grocery list and 500-cal high-protein recipes.
 * Replace or extend this with your real content.
 */

export interface Recipe {
  name: string;
  calories: number;
  protein: number; // grams
  prepTime: string;
  ingredients: string[];
  instructions: string[];
}

export interface GroceryCategory {
  category: string;
  items: string[];
}

// ─── Grocery List (bi-weekly) ─────────────────────────────────────────────────

export const GROCERY_LIST: GroceryCategory[] = [
  {
    category: '🥩 Proteins',
    items: [
      'Chicken breast (1.5 kg)',
      'Lean ground beef 5% fat (500 g)',
      'Salmon fillets (600 g)',
      'Greek yogurt 0% (1 kg)',
      'Eggs – free range (18 pack)',
      'Cottage cheese (500 g)',
      'Canned tuna in water (4 × 160 g)',
      'Whey protein isolate (top up if needed)',
    ],
  },
  {
    category: '🌾 Complex Carbs',
    items: [
      'Rolled oats (1 kg)',
      'Brown rice (1 kg)',
      'Sweet potatoes (1.5 kg)',
      'Whole-grain bread (1 loaf)',
      'Quinoa (500 g)',
    ],
  },
  {
    category: '🥦 Vegetables',
    items: [
      'Broccoli (2 heads)',
      'Spinach (300 g bag)',
      'Zucchini (3 pcs)',
      'Cherry tomatoes (500 g)',
      'Mixed peppers (4 pcs)',
      'Garlic (1 bulb)',
      'Fresh ginger (small knob)',
      'Cucumber (2 pcs)',
    ],
  },
  {
    category: '🍎 Fruits',
    items: [
      'Bananas (bunch of 6)',
      'Blueberries (300 g)',
      'Apples (4 pcs)',
      'Lemons (3 pcs)',
    ],
  },
  {
    category: '🫙 Pantry',
    items: [
      'Olive oil (extra virgin)',
      'Coconut aminos / soy sauce',
      'Sriracha / hot sauce',
      'Dijon mustard',
      'Salt, black pepper, paprika, cumin',
      'Canned chickpeas (2 cans)',
      'Peanut butter (natural, no sugar)',
      'Rice cakes (1 pack)',
    ],
  },
];

// ─── Recipes (500 cal, high-protein) ─────────────────────────────────────────

export const RECIPES: Recipe[] = [
  {
    name: 'Teriyaki Chicken & Brown Rice Bowl',
    calories: 495,
    protein: 48,
    prepTime: '25 min',
    ingredients: [
      '200 g chicken breast',
      '150 g cooked brown rice',
      '1 tbsp coconut aminos',
      '1 tsp sesame oil',
      '1 tsp fresh ginger (grated)',
      '1 clove garlic (minced)',
      '100 g broccoli florets',
      'Sesame seeds & spring onion to garnish',
    ],
    instructions: [
      'Mix coconut aminos, sesame oil, ginger, and garlic to make the marinade.',
      'Slice chicken and coat in marinade for 10 min.',
      'Steam broccoli 5 min until tender-crisp.',
      'Cook chicken in a non-stick pan over medium-high heat 6–7 min.',
      'Serve over brown rice, garnish with sesame seeds.',
    ],
  },
  {
    name: 'Salmon & Sweet Potato Power Bowl',
    calories: 510,
    protein: 42,
    prepTime: '30 min',
    ingredients: [
      '150 g salmon fillet',
      '200 g sweet potato (cubed)',
      '80 g spinach',
      '1 tsp olive oil',
      'Lemon juice, dill, salt & pepper',
    ],
    instructions: [
      'Roast sweet potato cubes at 200°C for 20 min.',
      'Season salmon with lemon, dill, salt & pepper.',
      'Pan-sear salmon 4 min per side.',
      'Wilt spinach in residual pan heat.',
      'Plate sweet potato, spinach, and salmon.',
    ],
  },
  {
    name: 'Greek Protein Oat Bowl',
    calories: 480,
    protein: 35,
    prepTime: '10 min',
    ingredients: [
      '80 g rolled oats',
      '200 ml water',
      '150 g Greek yogurt 0%',
      '1 scoop whey protein (vanilla)',
      '1 banana (sliced)',
      '50 g blueberries',
      '1 tbsp peanut butter',
    ],
    instructions: [
      'Cook oats with water (microwave 2 min or stove).',
      'Stir in Greek yogurt and whey protein until smooth.',
      'Top with banana, blueberries, and a drizzle of peanut butter.',
    ],
  },
  {
    name: 'Lean Beef & Veggie Stir-Fry with Quinoa',
    calories: 500,
    protein: 45,
    prepTime: '20 min',
    ingredients: [
      '150 g lean ground beef (5%)',
      '120 g cooked quinoa',
      '1 mixed pepper (sliced)',
      '100 g zucchini (sliced)',
      '1 tbsp soy sauce / coconut aminos',
      '1 tsp sriracha',
      '1 clove garlic',
      '½ tsp cumin',
    ],
    instructions: [
      'Brown ground beef in a hot pan, drain excess fat.',
      'Add garlic, peppers, and zucchini; stir-fry 4 min.',
      'Add soy sauce, sriracha, and cumin. Toss to combine.',
      'Serve over quinoa.',
    ],
  },
  {
    name: 'High-Protein Egg & Veggie Frittata',
    calories: 420,
    protein: 38,
    prepTime: '20 min',
    ingredients: [
      '4 large eggs',
      '100 g cottage cheese',
      '50 g cherry tomatoes (halved)',
      '80 g spinach',
      '30 g feta (optional)',
      'Salt, pepper, paprika',
    ],
    instructions: [
      'Preheat oven to 180°C. Whisk eggs with cottage cheese, salt, pepper, paprika.',
      'Pour into an oven-safe pan. Add tomatoes, spinach, and feta.',
      'Bake 15 min until set and golden.',
      'Slice into 4 wedges. Serve immediately or store for meal prep.',
    ],
  },
];
