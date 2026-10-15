// Inventaire fridge reader: looks at photos of the fridge, freezer or pantry
// and sorts what it finds against the shopper's staples into three buckets:
//   stocked  - visible and looks like plenty
//   low      - visible but running low
//   missing  - a staple that normally lives there but can't be seen
// A photo only shows the front of a shelf, so "missing" means "expected but
// not seen", never "confirmed out". The app treats it as a prompt to check.
// The API call itself lives in claude.js.

(function (root) {
  const SCHEMA = {
    type: 'object',
    properties: {
      areas: {
        type: 'array',
        description: 'Which storage areas the photos show.',
        items: { type: 'string', enum: ['fridge', 'freezer', 'pantry', 'other'] }
      },
      items: {
        type: 'array',
        description: 'Everything seen (stocked or low), then staples expected in the photographed areas but not seen (missing).',
        items: {
          type: 'object',
          properties: {
            seen: { type: 'string', description: 'What you saw and where, briefly, e.g. "Milk carton, about a quarter full, door shelf". For "missing", say where you looked, e.g. "Not on any fridge shelf or door".' },
            name: { type: 'string', description: 'What you would write on a shopping list: generic, no brand or size, e.g. "Milk", "Greek yogurt".' },
            match: { type: 'string', description: 'Exactly one of the shopper\'s staple names (copied character for character) if this is that item, else "". Brand and variety don\'t matter: "2% milk" is "Milk".' },
            section: { type: 'string', description: 'Best category for this item, chosen from the shopper\'s category names.' },
            verdict: { type: 'string', enum: ['stocked', 'low', 'missing'], description: '"stocked": visible, plenty left. "low": visible but nearly gone (last egg, a quarter carton, a nearly empty jar). "missing": a staple that normally lives in a photographed area, but you cannot see it.' },
            confident: { type: 'boolean', description: 'False if you\'re unsure: partly hidden, in an opaque or unlabeled container, can\'t judge how full, or the area behind is out of view.' }
          },
          required: ['seen', 'name', 'match', 'section', 'verdict', 'confident'],
          additionalProperties: false
        }
      }
    },
    required: ['areas', 'items'],
    additionalProperties: false
  };

  function buildPrompt(sections, nImages) {
    const staples = sections.map(s => `${s.name}: ${s.items.join(', ')}`).join('\n');
    const photos = nImages > 1
      ? `These ${nImages} photos show the shopper's kitchen storage (fridge, freezer and/or pantry). Treat them together and list each item once.\n\n`
      : '';
    return `${photos}Help the shopper decide what to buy by looking at what they have.

1. List every food or drink you can identify, with verdict "stocked" or "low". Judge "low" from what's actually visible: the last couple of eggs, a carton tipped light, a jar scraped near empty, one yogurt left. If you can't tell how full something is, say "stocked" and set confident to false. Skip things you can't identify.

2. Then go through the shopper's staples. For each staple that would normally be kept in an area these photos show, and that you cannot see, add it with verdict "missing". Only for areas actually photographed: don't call pantry staples missing from a fridge photo, or fridge staples missing from a pantry photo. Skip household supplies.

Be honest about what a photo can show. The front row reads well, but things behind other items, in drawers, in door shelves out of frame, or in opaque containers may simply be hidden. "Missing" means expected but not seen, not confirmed gone. Set confident to false whenever something could plausibly be out of view (for example, if the crisper drawers are closed, produce that lives there is not confidently missing).

The shopper's staples, by category:
${staples}`;
  }

  async function read(files, sections) {
    const out = await Claude.ask({
      files, slice: false, schema: SCHEMA, what: 'photo',
      prompt: n => buildPrompt(sections, n)
    });
    if (!out || !Array.isArray(out.items)) throw new Claude.AIError('parse', 'Claude couldn\'t make sense of that photo. Try a straighter shot with the light on and the door wide open.');
    if (!out.items.length) throw new Claude.AIError('parse', 'Nothing recognizable in that photo. Try again with the door wide open and the light on.');
    return out;
  }

  const api = { read, buildPrompt, SCHEMA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pantry = api;
})(typeof self !== 'undefined' ? self : this);
