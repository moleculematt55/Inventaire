// Inventaire staple search.
//
// Matches what you type against your staples three ways:
//   - by name, as you type: "ched" finds Cheddar, "tomato" finds Tomatoes
//   - by food group: "cheese" finds Cheddar, Parmesan, Goat cheese...;
//     "fruit" finds Apples, Bananas, Lemons...
//   - by category name: "spices" finds everything in Spices
// It also suggests common items in a searched group that aren't staples yet
// (search "cheese" and it offers American cheese, Mozzarella...), and guesses
// the right category for anything new you add.

(function (root) {
  // Each group: words that summon it, the category new members belong in,
  // words that identify a member, and common members to offer as new staples.
  const GROUPS = [
    { keys: ['cheese', 'cheeses'], section: 'Fridge',
      kw: ['cheese', 'cheddar', 'parmesan', 'parmigiano', 'pecorino', 'mozzarella', 'american', 'swiss', 'brie', 'feta', 'ricotta', 'gouda', 'provolone', 'monterey jack', 'pepper jack', 'havarti', 'gruyere', 'colby', 'manchego', 'halloumi', 'burrata', 'camembert', 'queso', 'mascarpone', 'asiago', 'romano'],
      add: ['American cheese', 'Mozzarella', 'Swiss cheese', 'Feta', 'Cream cheese', 'Ricotta', 'Provolone', 'Monterey Jack', 'Brie', 'Gouda', 'Cottage cheese', 'Shredded cheese', 'String cheese', 'Gruyère'] },
    { keys: ['dairy'], section: 'Fridge',
      not: ['peanut butter', 'almond butter', 'apple butter', 'cocoa butter', 'coconut milk', 'coconut cream'],
      kw: ['milk', 'cream', 'butter', 'yogurt', 'cheese', 'cheddar', 'parmesan', 'mozzarella', 'feta', 'ricotta', 'kefir', 'half and half', 'buttermilk', 'creme fraiche'],
      add: ['Half and half', 'Greek yogurt', 'Buttermilk', 'Cream cheese', 'Whipped cream'] },
    { keys: ['fruit', 'fruits'], section: 'Produce',
      not: ['juice', 'cider', 'jam', 'vinegar'],
      kw: ['apple', 'banana', 'berry', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'cranberry', 'lemon', 'lime', 'orange', 'clementine', 'grapefruit', 'grape', 'melon', 'watermelon', 'cantaloupe', 'peach', 'nectarine', 'pear', 'plum', 'cherry', 'mango', 'pineapple', 'kiwi', 'avocado', 'pomegranate', 'fig', 'apricot', 'persimmon'],
      add: ['Oranges', 'Limes', 'Grapes', 'Strawberries', 'Blueberries', 'Pears', 'Peaches', 'Pineapple', 'Mango', 'Watermelon', 'Clementines'] },
    { keys: ['vegetable', 'vegetables', 'veggie', 'veggies', 'veg'], section: 'Produce',
      kw: ['onion', 'garlic', 'shallot', 'potato', 'sweet potato', 'carrot', 'celery', 'tomato', 'bell pepper', 'pepper', 'lettuce', 'salad', 'green', 'spinach', 'broccoli', 'zucchini', 'mushroom', 'kale', 'cabbage', 'cauliflower', 'cucumber', 'corn', 'pea', 'green bean', 'asparagus', 'squash', 'eggplant', 'leek', 'radish', 'beet', 'scallion', 'arugula', 'brussels sprout', 'ginger', 'jalapeno'],
      not: ['black pepper', 'white pepper', 'pepper flake', 'chili flake', 'peanut', 'cornstarch', 'garlic powder', 'onion powder', 'ground ginger', 'peppercorn'],
      add: ['Cucumbers', 'Kale', 'Cauliflower', 'Green beans', 'Sweet potatoes', 'Scallions', 'Cabbage', 'Asparagus', 'Jalapeños', 'Red onions'] },
    { keys: ['herb', 'herbs'], section: 'Produce',
      kw: ['parsley', 'basil', 'cilantro', 'thyme', 'oregano', 'rosemary', 'dill', 'mint', 'sage', 'chive', 'bay leaf', 'bay', 'tarragon', 'herbes'],
      add: ['Fresh cilantro', 'Fresh dill', 'Fresh mint', 'Fresh rosemary', 'Fresh thyme', 'Chives'] },
    { keys: ['spice', 'spices', 'seasoning', 'seasonings'], section: 'Spices',
      not: ['bell pepper', 'jalapeno', 'fresh', 'salted', 'unsalted'],
      kw: ['salt', 'pepper', 'peppercorn', 'cumin', 'paprika', 'chili', 'cinnamon', 'oregano', 'thyme', 'bay', 'herbes', 'nutmeg', 'turmeric', 'clove', 'cardamom', 'coriander', 'curry', 'garlic powder', 'onion powder', 'cayenne', 'allspice', 'seasoning', 'italian seasoning'],
      add: ['Garlic powder', 'Onion powder', 'Smoked paprika', 'Turmeric', 'Nutmeg', 'Cayenne', 'Italian seasoning', 'Curry powder', 'Ground ginger'] },
    { keys: ['meat', 'meats', 'protein'], section: 'Meat & fish',
      not: ['stock', 'broth', 'bouillon', 'seasoning'],
      kw: ['chicken', 'beef', 'pork', 'bacon', 'sausage', 'steak', 'turkey', 'ham', 'lamb', 'prosciutto', 'salami', 'pepperoni', 'chorizo', 'hot dog', 'meatball', 'rib'],
      add: ['Ground turkey', 'Pork chops', 'Steak', 'Chicken thighs', 'Deli turkey', 'Deli ham', 'Hot dogs', 'Pepperoni'] },
    { keys: ['fish', 'seafood'], section: 'Meat & fish',
      kw: ['salmon', 'shrimp', 'tuna', 'cod', 'tilapia', 'crab', 'lobster', 'scallop', 'halibut', 'fish', 'mussel', 'clam', 'anchovy', 'sardine'],
      add: ['Cod', 'Tilapia', 'Scallops', 'Crab', 'Smoked salmon', 'Mussels'] },
    { keys: ['bread', 'breads', 'bakery'], section: 'Bread',
      kw: ['bread', 'baguette', 'bagel', 'tortilla', 'bun', 'roll', 'pita', 'english muffin', 'croissant', 'naan', 'sourdough', 'brioche'],
      add: ['Bagels', 'English muffins', 'Hamburger buns', 'Hot dog buns', 'Pita', 'Sourdough', 'Dinner rolls', 'Naan'] },
    { keys: ['grain', 'grains', 'carb', 'carbs', 'starch'], section: 'Pantry',
      kw: ['pasta', 'rice', 'oat', 'quinoa', 'couscous', 'noodle', 'cereal', 'barley', 'farro', 'spaghetti', 'penne', 'flour', 'bread'],
      add: ['Quinoa', 'Couscous', 'Spaghetti', 'Egg noodles', 'Brown rice', 'Cereal'] },
    { keys: ['baking'], section: 'Baking',
      kw: ['flour', 'sugar', 'baking powder', 'baking soda', 'yeast', 'vanilla', 'cocoa', 'chocolate chip', 'cornstarch', 'molasses', 'sprinkles'],
      add: ['Molasses', 'Almond flour', 'Sprinkles', 'Food coloring', 'Shortening'] },
    { keys: ['nut', 'nuts'], section: 'Pantry',
      kw: ['nut', 'almond', 'peanut', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'peanut butter', 'almond butter'],
      add: ['Almonds', 'Walnuts', 'Pecans', 'Cashews', 'Pistachios', 'Almond butter'] },
    { keys: ['sauce', 'sauces', 'condiment', 'condiments', 'dressing'], section: 'Oils & condiments',
      kw: ['sauce', 'mustard', 'mayonnaise', 'mayo', 'ketchup', 'salsa', 'bbq', 'sriracha', 'dressing', 'vinegar', 'relish', 'pesto', 'hot sauce', 'soy sauce', 'worcestershire'],
      add: ['Ketchup', 'Salsa', 'BBQ sauce', 'Sriracha', 'Ranch dressing', 'Worcestershire sauce', 'Pesto', 'Relish'] },
    { keys: ['oil', 'oils'], section: 'Oils & condiments',
      kw: ['oil', 'olive oil', 'cooking spray'],
      add: ['Sesame oil', 'Avocado oil', 'Cooking spray', 'Coconut oil'] },
    { keys: ['drink', 'drinks', 'beverage', 'beverages'], section: 'Pantry',
      kw: ['coffee', 'tea', 'juice', 'soda', 'seltzer', 'sparkling water', 'beer', 'wine', 'lemonade', 'kombucha'],
      add: ['Seltzer', 'Soda', 'Lemonade', 'Sparkling water', 'Beer', 'Wine'] },
    { keys: ['snack', 'snacks'], section: 'Pantry',
      kw: ['chip', 'cracker', 'nut', 'popcorn', 'pretzel', 'cookie', 'granola', 'bar', 'trail mix'],
      add: ['Tortilla chips', 'Crackers', 'Pretzels', 'Popcorn', 'Granola bars', 'Cookies'] },
    { keys: ['sweet', 'sweets', 'dessert', 'desserts', 'treat', 'treats'], section: 'Pantry',
      kw: ['ice cream', 'chocolate', 'cookie', 'honey', 'maple syrup', 'candy', 'jam', 'sugar'],
      add: ['Chocolate bar', 'Cookies', 'Jam', 'Candy'] },
    { keys: ['frozen'], section: 'Freezer',
      kw: ['frozen', 'ice cream', 'puff pastry', 'pizza'],
      add: ['Frozen pizza', 'Frozen spinach', 'Frozen corn', 'Frozen waffles', 'Ice cream'] },
    { keys: ['canned', 'can', 'cans'], section: 'Pantry',
      kw: ['canned', 'can', 'stock', 'broth'],
      add: ['Canned corn', 'Coconut milk', 'Tomato paste', 'Canned chickpeas'] },
    { keys: ['cleaning', 'cleaner', 'cleaners', 'clean'], section: 'Household',
      kw: ['soap', 'sponge', 'detergent', 'dishwasher', 'bleach', 'wipe', 'cleaner', 'spray'],
      add: ['All-purpose cleaner', 'Disinfecting wipes', 'Bleach', 'Hand soap', 'Glass cleaner'] },
    { keys: ['paper'], section: 'Household',
      kw: ['paper', 'towel', 'napkin', 'toilet', 'tissue', 'foil', 'parchment', 'plastic wrap', 'bag'],
      add: ['Toilet paper', 'Napkins', 'Tissues', 'Plastic wrap'] },
    { keys: ['breakfast'], section: 'Pantry',
      kw: ['egg', 'bacon', 'oat', 'cereal', 'yogurt', 'bagel', 'coffee', 'pancake', 'syrup', 'waffle', 'granola', 'english muffin'],
      add: ['Cereal', 'Pancake mix', 'Granola', 'Frozen waffles'] }
  ];

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Rough singular, applied the same way to both sides of a comparison.
  function sing(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
    if (w.length > 4 && /(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  const words = s => norm(s).split(' ').filter(Boolean).map(sing);

  // Is the word sequence `kw` inside `item` (both singularized word lists)?
  function contains(item, kw) {
    outer: for (let i = 0; i + kw.length <= item.length; i++) {
      for (let j = 0; j < kw.length; j++) if (item[i + j] !== kw[j]) continue outer;
      return true;
    }
    return false;
  }

  function inGroup(name, g) {
    const w = words(name);
    if ((g.not || []).some(k => contains(w, words(k)))) return false;
    return g.kw.some(k => contains(w, words(k)));
  }

  // Groups the query refers to ("chee" already means cheese, at 3+ letters).
  function groupsFor(query) {
    const q = norm(query);
    if (q.length < 3) return [];
    return GROUPS.filter(g => g.keys.some(k => k === q || (k.startsWith(q) && q.length >= 3) || sing(q) === sing(k)));
  }

  // 0 = no match. Higher = better.
  function score(query, name, sectionName) {
    const qRaw = norm(query).split(' ').filter(Boolean);
    if (!qRaw.length) return 0;
    const qw = qRaw.map(sing);
    const raw = norm(name).split(' ').filter(Boolean);
    const iw = raw.map(sing);
    // Every typed word matches a word of the name; the last one can still be
    // half-typed ("goat chee"). Plurals don't matter ("tomato" = "Tomatoes").
    const direct = qRaw.every((q, k) => {
      const forms = [q, qw[k]];
      const last = k === qRaw.length - 1;
      return raw.some((w, i) => forms.some(f => last ? (w.startsWith(f) || iw[i].startsWith(f)) : (w === f || iw[i] === f)));
    });
    if (direct) return norm(name).startsWith(norm(query)) ? 4 : 3;
    const groups = groupsFor(query);
    if (groups.some(g => inGroup(name, g))) return 2;
    if (groups.length) return 0; // "fish" means fish, not everything in "Meat & fish"
    const sw = words(sectionName);
    if (sw.length && qw.length === 1 && sw.some(w => w.startsWith(qw[0]) && qw[0].length >= 3)) return 1;
    return 0;
  }

  // Best category for a new item, using the shopper's own category names.
  function guessSection(name, sectionNames, history) {
    const has = s => sectionNames.includes(s) ? s : null;
    for (let i = (history || []).length - 1; i >= 0; i--) {
      const it = history[i].items.find(x => norm(x.name) === norm(name));
      if (it && has(it.section)) return it.section;
    }
    const g = GROUPS.find(g => inGroup(name, g)) || groupsFor(name)[0];
    if (g && has(g.section)) return g.section;
    return has('Pantry') || sectionNames[0];
  }

  // Common members of the searched group that aren't staples yet, plus
  // anything you've bought before (from history) that matches.
  function suggestions(query, staples, history, max) {
    const have = staples.map(norm);
    const covered = n => {
      const x = norm(n);
      const xw = words(x);
      // "American cheese" is covered by a staple called "American".
      const bare = xw[xw.length - 1] === 'cheese' ? xw.slice(0, -1).join(' ') : null;
      return have.some(h => h === x || words(h).join(' ') === xw.join(' ') || (bare && words(h).join(' ') === bare));
    };
    const out = [], seen = new Set();
    const push = (name, why, section) => {
      const k = words(name).join(' ');
      if (seen.has(k) || covered(name)) return;
      seen.add(k); out.push({ name, why, section });
    };
    const q = norm(query);
    if (q) {
      for (let i = (history || []).length - 1; i >= 0; i--) {
        for (const it of history[i].items) if (score(query, it.name, '') >= 3) push(it.name, 'Bought before', it.section);
      }
    }
    for (const g of groupsFor(query)) for (const n of g.add) push(n, '', g.section);
    for (const g of GROUPS) for (const n of g.add) if (q && score(query, n, '') >= 3) push(n, '', g.section);
    return out.slice(0, max || 10);
  }

  function titleCase(s) {
    const t = String(s || '').trim().replace(/\s+/g, ' ');
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  }

  const api = { score, guessSection, suggestions, groupsFor, norm, titleCase, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Search = api;
})(typeof self !== 'undefined' ? self : this);
