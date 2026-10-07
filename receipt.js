// Inventaire receipt reader: turns a receipt photo into priced lines matched
// to the shopper's staples. The API call itself lives in claude.js.

(function (root) {
  // JSON schema for structured output. Every property is required and no
  // nullable types are used: "none" is 0 or an empty string instead.
  const SCHEMA = {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Store name as a shopper would say it, e.g. "Dave\'s Marketplace". Empty if unreadable.' },
        store_location: { type: 'string', description: 'Town or branch, e.g. "Coventry, RI". Empty if not printed.' },
        purchased_at: { type: 'string', description: 'Local date and time of purchase as YYYY-MM-DDTHH:MM, or YYYY-MM-DD if no time. Empty if not printed.' },
        total: { type: 'number', description: 'Final amount paid.' },
        tax: { type: 'number', description: 'Total tax, 0 if none.' },
        item_count: { type: 'integer', description: 'Item count if the receipt prints one, else 0.' },
        lines: {
          type: 'array',
          description: 'One entry per purchased line, in receipt order. A line printed twice (bought twice) appears twice.',
          items: {
            type: 'object',
            properties: {
              raw: { type: 'string', description: 'The item text exactly as printed, e.g. "HOLL HSE WHITE CKN".' },
              name: { type: 'string', description: 'Plain, generic shopping-list name a person would write, e.g. "White cooking wine", "Steak", "Deli ham". No brand unless the brand is the product.' },
              qty: { type: 'number', description: 'Units on this line, e.g. 2 for "2 @ 1.99". Use 1 for weighed items.' },
              price: { type: 'number', description: 'Final price for this line after any discount printed against it.' },
              unit_price: { type: 'number', description: 'Price per unit or per lb/kg if printed (e.g. 3.99 for "0.23 lb @ 3.99 /lb"), else 0.' },
              unit: { type: 'string', description: '"lb", "kg", "oz" or "ea" when unit_price is set, else "".' },
              match: { type: 'string', description: 'Exactly one of the shopper\'s staple names (copied character for character) if this line is that item, else "". Brands and sizes don\'t matter: "FAIRLIFE MILK WHL" is "Milk".' },
              section: { type: 'string', description: 'Best category for this item, chosen from the shopper\'s category names.' },
              kind: { type: 'string', enum: ['grocery', 'household', 'fee', 'other'], description: '"fee" for bag fees, bottle deposits and similar.' },
              confident: { type: 'boolean', description: 'False if the abbreviation is ambiguous and the name is a guess.' }
            },
            required: ['raw', 'name', 'qty', 'price', 'unit_price', 'unit', 'match', 'section', 'kind', 'confident'],
            additionalProperties: false
          }
        }
      },
      required: ['store', 'store_location', 'purchased_at', 'total', 'tax', 'item_count', 'lines'],
      additionalProperties: false
  };

  function buildPrompt(sections, nSlices, today) {
    const staples = sections.map(s => `${s.name}: ${s.items.join(', ')}`).join('\n');
    const sliceNote = nSlices > 1
      ? `The ${nSlices} images are consecutive sections of ONE long receipt, top to bottom. Neighboring sections overlap slightly, so a line near the bottom of one image may reappear at the top of the next: record it once. Two identical lines that both appear fully inside the same image are two separate purchases.\n\n`
      : '';
    return `${sliceNote}Read this grocery receipt and record every purchased line.

Decode store abbreviations into what the item actually is (e.g. "HOLL HSE WHITE CKN" is Holland House white cooking wine, "GRADE A LRG BRWN E" is large brown eggs). Discounts or coupons printed under an item reduce that item's price; don't list them as lines. Skip subtotal, tax, payment, change and savings lines.

Check your work: line prices plus tax should add up to the total, and the number of lines should match any printed item count. If they don't, look again for a missed or doubled line.

Today is ${today}. The shopper's staples, by category:
${staples}`;
  }

  async function read(file, sections) {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const out = await Claude.ask({
      files: [file], slice: true, schema: SCHEMA, what: 'receipt',
      prompt: n => buildPrompt(sections, n, today)
    });
    if (!out || !Array.isArray(out.lines)) throw new Claude.AIError('parse', 'Claude couldn\'t make sense of that photo. Try a straighter, closer shot in good light.');
    if (!out.lines.length) throw new Claude.AIError('parse', 'No items found. Is that a grocery receipt?');
    return out;
  }

  const api = { read, buildPrompt, SCHEMA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof self !== 'undefined' ? self : this);
