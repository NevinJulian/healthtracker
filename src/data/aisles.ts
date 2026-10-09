import type { ShoppingListItem } from '../db/database';
import { shoppingKey } from './shoppingMerge';

export const AISLES = [
  'Produce',
  'Meat and fish',
  'Dairy and eggs',
  'Bakery',
  'Pantry',
  'Tins and jars',
  'Frozen',
  'Spices and oils',
  'Drinks',
  'Other',
] as const;

export type Aisle = (typeof AISLES)[number];

// Keywords of four or more characters match anywhere in the name, shorter ones only as a whole
// word. The longest match wins across sections, so compound entries ("coconut milk", "frozen
// broccoli") override the plain ingredient they contain.
export const AISLE_KEYWORDS: Record<Exclude<Aisle, 'Other'>, string[]> = {
  Produce: [
    'onion', 'zwiebel', 'spring onion', 'frühlingszwiebel', 'shallot', 'schalotte', 'garlic', 'knoblauch',
    'potato', 'kartoffel', 'sweet potato', 'süßkartoffel', 'süsskartoffel', 'carrot', 'karotte', 'möhre',
    'tomato', 'tomate', 'cherry tomato', 'cucumber', 'gurke', 'courgette', 'zucchini', 'aubergine',
    'eggplant', 'bell pepper', 'peppers', 'red pepper', 'green pepper', 'yellow pepper', 'paprikaschote',
    'chilli', 'chili', 'red chilli', 'red chili', 'fresh chilli', 'broccoli', 'brokkoli', 'cauliflower', 'blumenkohl',
    'cabbage', 'kohl', 'kohlrabi', 'rosenkohl', 'brussels sprout', 'spinach', 'spinat', 'kale', 'grünkohl',
    'lettuce', 'salad', 'salat', 'rocket', 'rucola', 'arugula', 'mangold', 'chard', 'feldsalat', 'watercress',
    'kresse', 'celery', 'sellerie', 'leek', 'lauch', 'fennel', 'fenchel', 'asparagus', 'spargel', 'radish',
    'radieschen', 'rettich', 'beetroot', 'rote bete', 'pumpkin', 'kürbis', 'butternut', 'squash', 'mushroom',
    'champignon', 'pilz', 'pilze', 'avocado', 'ginger', 'ingwer', 'corn', 'sweetcorn', 'mais', 'peas', 'pea',
    'green beans', 'bean sprout', 'sugar snap', 'mangetout', 'apple', 'apfel', 'pear', 'birne', 'banana',
    'banane', 'lemon', 'zitrone', 'lime', 'limette', 'orange', 'grapefruit', 'mandarin', 'clementine',
    'berries', 'strawberr', 'erdbeer', 'raspberr', 'himbeer', 'blueberr', 'heidelbeer', 'blackberr',
    'brombeer', 'grape', 'traube', 'mango', 'pineapple', 'ananas', 'melon', 'kiwi', 'peach', 'pfirsich',
    'plum', 'pflaume', 'cherries', 'kirsche', 'fig', 'figs', 'basil', 'basilikum', 'thai basil',
    'parsley', 'petersilie', 'coriander', 'koriander', 'cilantro', 'chives', 'schnittlauch', 'dill', 'mint',
    'minze', 'fresh basil', 'fresh parsley', 'fresh coriander', 'fresh dill', 'fresh chives', 'fresh mint',
    'fresh thyme', 'fresh rosemary', 'fresh herbs', 'frische kräuter', 'sprouts', 'edamame pods',
  ],
  'Meat and fish': [
    'chicken', 'huhn', 'hähnchen', 'hühner', 'poulet', 'turkey', 'pute', 'truthahn', 'duck', 'ente',
    'beef', 'rind', 'veal', 'kalb', 'pork', 'schwein', 'lamb', 'lamm', 'venison', 'mince',
    'hackfleisch', 'gehacktes', 'steak', 'fillet', 'filet', 'ribs', 'rippchen', 'bacon', 'speck',
    'ham', 'schinken', 'sausage', 'wurst', 'würstchen', 'salami', 'chorizo', 'fleisch',
    'meat', 'liver', 'leber', 'salmon', 'lachs', 'tuna', 'thunfisch', 'cod', 'kabeljau', 'haddock',
    'mackerel', 'makrele', 'trout', 'forelle', 'sardine', 'anchov', 'herring', 'hering', 'sea bass',
    'seebarsch', 'tilapia', 'prawn', 'shrimp', 'garnele', 'crab', 'krabbe', 'lobster', 'mussel',
    'muschel', 'squid', 'calamari', 'fish', 'fisch', 'seafood', 'tofu', 'tempeh', 'seitan',
  ],
  'Dairy and eggs': [
    'milk', 'milch', 'buttermilk', 'cream', 'rahm', 'sahne', 'schmand', 'sour cream', 'saure sahne',
    'creme fraiche', 'crème fraîche', 'butter', 'ghee', 'margarine', 'cheese', 'käse', 'frischkäse',
    'hüttenkäse', 'cottage', 'cheddar', 'mozzarella', 'parmesan', 'pecorino', 'feta', 'halloumi', 'brie',
    'camembert', 'gouda', 'emmentaler', 'gruyère', 'gruyere', 'ricotta', 'mascarpone', 'quark', 'skyr',
    'yogurt', 'yoghurt', 'joghurt', 'kefir', 'egg', 'eggs', 'eier', 'ei', 'eiweiß', 'eigelb',
  ],
  Bakery: [
    'bread', 'brot', 'brötchen', 'semmel', 'toast', 'baguette', 'ciabatta', 'focaccia', 'sourdough',
    'sauerteig', 'bagel', 'croissant', 'muffin', 'scone', 'bun', 'buns', 'rolls', 'tortilla', 'wrap',
    'wraps', 'naan', 'pitta', 'pita', 'flatbread', 'fladenbrot', 'crispbread', 'knäckebrot',
    'pumpernickel', 'brezel', 'pretzel', 'zopf', 'taco shell', 'pizza dough', 'pizzateig', 'kuchen',
    'cake',
  ],
  Pantry: [
    'rice', 'reis', 'rice cake', 'reiswaffel', 'pasta', 'nudel', 'spaghetti', 'penne', 'fusilli',
    'macaroni', 'orzo', 'noodle', 'lasagne', 'gnocchi', 'couscous', 'quinoa', 'bulgur', 'polenta',
    'oat', 'oats', 'rolled oats', 'hafer', 'haferflocken', 'porridge', 'muesli', 'müsli', 'granola',
    'cereal', 'cornflakes', 'spelt', 'dinkel', 'barley', 'gerste', 'buckwheat', 'buchweizen', 'millet',
    'hirse', 'semolina', 'grieß', 'flour', 'mehl', 'cornstarch', 'stärke', 'baking powder', 'backpulver',
    'baking soda', 'natron', 'yeast', 'hefe', 'breadcrumb', 'paniermehl', 'semmelbrösel', 'sugar',
    'zucker', 'vanilla sugar', 'vanillezucker', 'honey', 'honig', 'syrup', 'agave', 'chocolate',
    'schokolade', 'cocoa', 'kakao', 'lentil', 'linse', 'beans', 'nut', 'nuts', 'nüsse', 'almond',
    'mandel', 'walnut', 'walnuss', 'cashew', 'hazelnut', 'haselnuss', 'pistachio', 'pistazie', 'peanut',
    'erdnuss', 'pine nut', 'pinienkern', 'coconut', 'seeds', 'chia', 'flax', 'leinsamen', 'sesame',
    'sesam', 'sunflower seed', 'sonnenblumenkern', 'kürbiskern', 'raisin', 'rosine', 'dates', 'dattel',
    'dried fruit', 'trockenfrüchte', 'peanut butter', 'erdnussbutter', 'almond butter', 'nut butter',
    'protein powder', 'whey', 'dried porcini', 'eiweißpulver', 'pea protein', 'cracker',
  ],
  'Tins and jars': [
    'canned', 'tinned', 'konserve', 'jar', 'tin', 'can', 'tomato paste', 'tomatenmark', 'passata',
    'crushed tomato', 'diced tomato', 'chopped tomato', 'gehackte tomaten', 'passierte tomaten',
    'tomato puree', 'tuna in', 'tomato salsa', 'tomato sauce', 'salsa', 'sauce', 'soße', 'sosse', 'ketchup',
    'mayonnaise', 'mayo', 'mustard', 'senf', 'dressing', 'vinaigrette', 'pesto', 'hummus', 'tahini',
    'olives', 'oliven', 'capers', 'kapern', 'pickle', 'pickled', 'eingelegt', 'gherkin', 'cornichon',
    'sauerkraut', 'jam', 'marmelade', 'konfitüre', 'apfelmus', 'coconut milk', 'kokosmilch',
    'coconut cream', 'kokoscreme', 'chickpea', 'kichererbse', 'kidney', 'black beans', 'white beans',
    'pinto', 'baked beans', 'sun-dried', 'sundried', 'roasted red pepper', 'artichoke heart',
    'artischocken', 'water chestnut', 'wasserkastanie', 'bamboo shoot', 'chipotle', 'adobo', 'enchilada',
    'curry paste', 'currypaste', 'miso', 'sambal', 'harissa', 'chutney', 'broth', 'brühe', 'bouillon',
    'stock', 'fond', 'vegetable broth', 'chicken broth', 'beef broth', 'chicken stock', 'beef stock', 'vegetable stock', 'lemon juice', 'lime juice', 'zitronensaft', 'limettensaft',
  ],
  Frozen: [
    'frozen', 'tiefkühl', 'gefroren', 'ice cream', 'eiscreme', 'eis', 'sorbet', 'ice cubes', 'eiswürfel',
    'fish fingers', 'fischstäbchen', 'nuggets', 'fries', 'pommes', 'pizza', 'blätterteig', 'puff pastry',
    'filo', 'phyllo', 'waffles', 'dumplings', 'gyoza', 'spring roll', 'frühlingsrolle', 'edamame',
    'frozen broccoli', 'frozen spinach', 'frozen green bean', 'frozen sweetcorn', 'frozen pepper',
    'frozen berries', 'frozen pea', 'frozen carrot', 'frozen onion', 'frozen potato', 'frozen corn', 'frozen mixed', 'frozen stir', 'frozen vegetable', 'frozen raspberr',
    'frozen strawberr', 'frozen blueberr', 'frozen mango', 'frozen cauliflower', 'frozen chicken',
    'frozen salmon', 'frozen shrimp', 'frozen prawn', 'frozen fish',
  ],
  'Spices and oils': [
    'salt', 'salz', 'sea salt', 'meersalz', 'pepper', 'pfeffer', 'black pepper', 'schwarzer pfeffer',
    'paprika', 'smoked paprika', 'cumin', 'kreuzkümmel', 'kümmel', 'caraway', 'turmeric', 'kurkuma',
    'cinnamon', 'zimt', 'nutmeg', 'muskat', 'oregano', 'thyme', 'thymian', 'rosemary', 'rosmarin',
    'bay leaf', 'bay leaves', 'lorbeer', 'cardamom', 'kardamom', 'cayenne', 'chilli powder',
    'chili powder', 'chilli flakes', 'chili flakes', 'saffron', 'safran', 'vanilla', 'vanille',
    'curry', 'curry powder', 'currypulver', 'garam masala', 'tikka masala', 'sumac', "za'atar", 'dried',
    'dried basil', 'dried dill', 'dried parsley', 'dried rosemary', 'dried thyme', 'dried oregano',
    'ground coriander', 'coriander (ground)', 'fennel seed', 'mustard seed', 'garlic powder',
    'knoblauchpulver', 'onion powder', 'zwiebelpulver', 'seasoning', 'gewürz', 'spice', 'italian seasoning',
    'herbes de provence', 'oil', 'öl', 'olive oil', 'olivenöl', 'rapsöl', 'sonnenblumenöl', 'sesame oil',
    'sesamöl', 'coconut oil', 'kokosöl', 'vegetable oil', 'avocado oil', 'cooking spray', 'sprühöl',
    'vinegar', 'essig', 'balsamic', 'balsamico', 'weinessig',
  ],
  Drinks: [
    'water', 'wasser', 'mineral', 'sparkling', 'sprudel', 'soda water', 'tonic', 'juice', 'saft',
    'orange juice', 'apple juice', 'orangensaft', 'apfelsaft', 'schorle', 'oat milk', 'almond milk',
    'soy milk', 'plant milk', 'hafermilch', 'mandelmilch', 'sojamilch', 'coconut water', 'tea', 'tee',
    'iced tea', 'eistee', 'peppermint', 'pfefferminz', 'matcha', 'coffee', 'kaffee', 'espresso', 'cola',
    'lemonade', 'limonade', 'kombucha', 'smoothie', 'ginger beer', 'beer', 'bier', 'wine', 'wein',
    'prosecco', 'champagne', 'vodka', 'whisky', 'whiskey', 'gin', 'rum', 'energy drink', 'getränk',
    'protein shake',
  ],
};

interface KeywordEntry {
  aisle: Exclude<Aisle, 'Other'>;
  keyword: string;
  wholeWord: boolean;
}

const KEYWORD_ENTRIES: KeywordEntry[] = AISLES.filter(
  (a): a is Exclude<Aisle, 'Other'> => a !== 'Other',
).flatMap((aisle) =>
  AISLE_KEYWORDS[aisle].map((keyword) => ({ aisle, keyword, wholeWord: keyword.length <= 3 })),
);

export function aisleFor(name: string): Aisle {
  const key = shoppingKey(name);
  const words = new Set(key.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  let best: Aisle = 'Other';
  let bestLength = 0;
  for (const entry of KEYWORD_ENTRIES) {
    if (entry.keyword.length <= bestLength) continue;
    const hit = entry.wholeWord ? words.has(entry.keyword) : key.includes(entry.keyword);
    if (hit) {
      best = entry.aisle;
      bestLength = entry.keyword.length;
    }
  }
  return best;
}

export interface AisleGroup {
  aisle: Aisle;
  items: ShoppingListItem[];
}

function compareItems(a: ShoppingListItem, b: ShoppingListItem): number {
  if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1;
  const byName = shoppingKey(a.ingredient_name).localeCompare(shoppingKey(b.ingredient_name), undefined, {
    sensitivity: 'base',
  });
  return byName !== 0 ? byName : a.id - b.id;
}

export function groupByAisle(items: ShoppingListItem[]): AisleGroup[] {
  const buckets = new Map<Aisle, ShoppingListItem[]>();
  for (const item of items) {
    const aisle = aisleFor(item.ingredient_name);
    const bucket = buckets.get(aisle);
    if (bucket) bucket.push(item);
    else buckets.set(aisle, [item]);
  }
  return AISLES.flatMap((aisle) => {
    const bucket = buckets.get(aisle);
    return bucket ? [{ aisle, items: [...bucket].sort(compareItems) }] : [];
  });
}
