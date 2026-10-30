// Inventaire weekly deals: reads a store's online weekly ad and returns its
// deals matched to the shopper's staples, with the dates the sale runs.
//
// The app can't open other sites itself (browsers block that), so it asks
// Claude to fetch the store's ad page, follow it to the current flyer PDF and
// read it. Fetching is done by Claude's web_fetch tool, on Anthropic's side.

(function (root) {
  const DAY = 864e5;

  // Stores with a known ad page. Others can be added in the app with any
  // page that shows or links to the weekly ad.
  const PRESETS = [
    {
      id: 'daves', name: 'Dave\'s Marketplace',
      url: 'https://www.davesmarketplace.com/WeeklySpecials/',
      hint: 'This page links to the current "Weekly Specials" PDF (a link like /content/weeklyspecials/MM-DD-YYYY.pdf) and a "Mid-Week Specials" PDF. Read the Weekly Specials PDF. Also read the Mid-Week Specials PDF if its dates include today, and put its dates in each deal\'s note.'
    },
    {
      id: 'marketbasket', name: 'Market Basket',
      url: 'https://www.shopmarketbasket.com/view-classic-flyer/',
      hint: 'This page has a download link to the current flyer, like https://www.shopmarketbasket.com/embedded-pdf?id=%2Fdownload%2F12345%2F%3Ftmstv%3D123. Fetch that link exactly as written on the page; it returns the flyer itself. The flyer usually runs Sunday to Saturday.'
    }
  ];

  const SCHEMA = {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'True if you found and read a current weekly ad.' },
      problem: { type: 'string', description: 'If found is false, a short plain reason, e.g. "The ad page didn\'t load". Else "".' },
      valid_from: { type: 'string', description: 'First day of the sale, YYYY-MM-DD. "" if not printed.' },
      valid_to: { type: 'string', description: 'Last day of the sale, YYYY-MM-DD. "" if not printed.' },
      deals: {
        type: 'array',
        description: 'Every food and household deal in the ad.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'The item as advertised, with brand and size, e.g. "Cabot Sharp Cheddar, 8 oz".' },
            name: { type: 'string', description: 'Generic shopping-list name, e.g. "Cheddar", "Chicken thighs", "Coffee".' },
            match: { type: 'string', description: 'Exactly one of the shopper\'s staple names (copied character for character) if this deal is for that item, else "". Brand and size don\'t matter: "Folgers Classic Roast" is "Coffee", "Boneless chicken breast" is "Chicken".' },
            section: { type: 'string', description: 'Best category, chosen from the shopper\'s category names.' },
            price: { type: 'number', description: 'Sale price for one unit (per lb when sold by weight). "2 for $5" is 2.5. 0 if there is no single price, e.g. buy one get one.' },
            unit: { type: 'string', enum: ['ea', 'lb', ''], description: '"lb" if priced by weight, "ea" if per item or package, "" if no single price.' },
            price_text: { type: 'string', description: 'The deal as a shopper would say it, short: "$2.99/lb", "2 for $5", "Buy 1 get 1 free", "$3.49 with 4".' },
            regular_price: { type: 'number', description: 'Regular price per unit if printed, else 0.' },
            note: { type: 'string', description: 'Conditions worth knowing, short: "limit 2", "when you buy 4", "Tue & Wed only". Else "".' }
          },
          required: ['item', 'name', 'match', 'section', 'price', 'unit', 'price_text', 'regular_price', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['found', 'problem', 'valid_from', 'valid_to', 'deals'],
    additionalProperties: false
  };

  const TOOLS = [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 4, max_content_tokens: 90000 }];

  function buildPrompt(store, sections, today) {
    const staples = sections.map(s => `${s.name}: ${s.items.join(', ')}`).join('\n');
    return `Today is ${today}. Find and read the current weekly ad for ${store.name}.

Start here: ${store.url}
${store.hint ? store.hint + '\n' : ''}
Fetch that page, follow it to the weekly ad (usually a PDF), and read every page. The flyer layout is visual, so pair each price with the item it sits next to; don't guess when a price can't be tied to an item. Skip alcohol, gift cards, and store announcements.

If the ad you find is for a past week or hasn't started yet, still read it and give its real dates. If you can't find or read an ad, set found to false and say why in a few words.

The shopper's staples, by category:
${staples}`;
  }

  async function read(store, sections) {
    const today = new Date().toLocaleDateString('en-CA');
    const out = await Claude.ask({
      files: [], schema: SCHEMA, what: 'ad', tools: TOOLS, maxTokens: 20000,
      prompt: () => buildPrompt(store, sections, today)
    });
    if (!out || !Array.isArray(out.deals)) throw new Claude.AIError('parse', 'Claude couldn\'t make sense of the ad. Try again later.');
    if (!out.found || !out.deals.length) throw new Claude.AIError('notfound', `Couldn't find this week's ad for ${store.name}` + (out.problem ? `: ${out.problem}` : '.'));
    return out;
  }

  // "2026-10-25" -> local midnight ms, or null.
  function day(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }

  // When an ad stops being current: end of its last day, or a week after
  // it was fetched if no dates were printed.
  function endsAt(ad) {
    const to = day(ad.to);
    return to ? to + DAY : (ad.fetched || 0) + 7 * DAY;
  }
  function isCurrent(ad, now) {
    now = now || Date.now();
    const from = day(ad.from);
    return now < endsAt(ad) && (!from || now >= from);
  }

  function shortDates(ad) {
    const f = day(ad.from), t = day(ad.to);
    const fmt = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (f && t) return `${fmt(f)} – ${fmt(t)}`;
    if (t) return 'until ' + fmt(t);
    return '';
  }

  const api = { read, PRESETS, SCHEMA, TOOLS, buildPrompt, isCurrent, endsAt, shortDates, day };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Deals = api;
})(typeof self !== 'undefined' ? self : this);
