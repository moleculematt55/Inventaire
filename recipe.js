// Inventaire recipe reader: turns photos of a recipe (a cookbook page, a
// card, a screenshot) into a title, an ingredient list matched to the
// shopper's staples, and the steps. The API call itself lives in claude.js.

(function (root) {
  const SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Recipe name, in normal title case. Empty if no recipe is visible.' },
      servings: { type: 'string', description: 'What the recipe makes, e.g. "4", "6 to 8", "1 loaf". Empty if not stated.' },
      source: { type: 'string', description: 'Cookbook, website or author if printed on the page, else "".' },
      ingredients: {
        type: 'array',
        description: 'Every ingredient, in the order printed.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The ingredient line as printed, e.g. "3 cloves garlic, minced".' },
            name: { type: 'string', description: 'What you would write on a shopping list: generic, no amount or prep. "3 cloves garlic, minced" is "Garlic"; "juice of 1 lemon" is "Lemons"; "1 stick unsalted butter, softened" is "Butter".' },
            amount: { type: 'string', description: 'Amount as a short phrase, e.g. "3 cloves", "2 cups", "1 lb". Empty if none.' },
            match: { type: 'string', description: 'Exactly one of the shopper\'s staple names (copied character for character) if this ingredient is that item, else "". Prep and variety don\'t matter: "unsalted butter" is "Butter", "yellow onion" is "Onions".' },
            section: { type: 'string', description: 'Best category for this ingredient, chosen from the shopper\'s category names.' },
            shop: { type: 'boolean', description: 'False for things nobody buys: water, ice, or something made earlier in this recipe ("the reserved sauce"). True otherwise.' },
            optional: { type: 'boolean', description: 'True if marked optional, "for garnish", or "to serve".' },
            group: { type: 'string', description: 'Sub-heading the ingredient is listed under, e.g. "For the sauce". Empty if none.' }
          },
          required: ['text', 'name', 'amount', 'match', 'section', 'shop', 'optional', 'group'],
          additionalProperties: false
        }
      },
      steps: {
        type: 'array',
        description: 'The method, one entry per step, in order.',
        items: { type: 'string' }
      }
    },
    required: ['title', 'servings', 'source', 'ingredients', 'steps'],
    additionalProperties: false
  };

  function buildPrompt(sections, nImages) {
    const staples = sections.map(s => `${s.name}: ${s.items.join(', ')}`).join('\n');
    const pages = nImages > 1
      ? `The ${nImages} images are pages of ONE recipe, in order. Combine them into a single recipe.\n\n`
      : '';
    return `${pages}Read this recipe and record its title, ingredients and steps.

Split combined lines into separate ingredients: "salt and pepper to taste" is two ingredients, "Salt" and "Black pepper". Keep an ingredient that appears in two places (e.g. butter in the dough and in the topping) as two entries, each with its own amount.

If the image is not a recipe, return an empty title and no ingredients.

The shopper's staples, by category:
${staples}`;
  }

  async function read(files, sections) {
    const out = await Claude.ask({
      files, slice: false, schema: SCHEMA, what: 'recipe', maxTokens: 12000,
      prompt: n => buildPrompt(sections, n)
    });
    if (!out || !Array.isArray(out.ingredients)) throw new Claude.AIError('parse', 'Claude couldn\'t make sense of that photo. Try a straighter, closer shot in good light.');
    if (!out.ingredients.length) throw new Claude.AIError('parse', 'No ingredients found. Is that a recipe? If the ingredients are on another page, include that photo too.');
    return out;
  }

  const api = { read, buildPrompt, SCHEMA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recipe = api;
})(typeof self !== 'undefined' ? self : this);
