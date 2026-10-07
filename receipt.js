// Inventaire receipt reader.
//
// Turns a photo of a grocery receipt into structured lines by sending it to
// the Claude API with the user's own API key (stored only on this device).
// Long receipts are sliced into overlapping sections first, because the API
// shrinks any image whose long edge exceeds 2576 px, and a whole receipt
// shrunk that far is too small to read.

(function (root) {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-5-5';
  const KEY_STORE = 'inventaire-api-key';

  const MAX_EDGE = 2576;          // API's high-resolution long-edge limit
  const MAX_PIXELS = 3.6e6;       // stays under the per-image visual token cap
  const SLICE_ASPECT = 1.6;       // slice anything taller than this (height / width)
  const OVERLAP = 0.07;           // share of each slice repeated in the next

  // ---------- API key (never part of backups) ----------
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) {
    try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); return true; }
    catch (e) { return false; }
  }

  // ---------- Image prep ----------
  async function loadBitmap(file) {
    // createImageBitmap honors the photo's EXIF rotation in Chrome.
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  function toJpegBase64(canvas) {
    return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
  }

  // Plan vertical slices of a w x h image: [{y, h}] in source pixels.
  function planSlices(w, h) {
    if (h / w <= SLICE_ASPECT * 1.15) return [{ y: 0, h }];
    // Even slices with a small fixed overlap (a few printed lines), so no
    // line is ever cut in half and as few lines as possible appear twice.
    const maxH = w * SLICE_ASPECT;
    const ov = Math.round(maxH * OVERLAP);
    const n = Math.ceil((h - ov) / (maxH - ov));
    const sliceH = Math.ceil((h + (n - 1) * ov) / n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = Math.min(i * (sliceH - ov), h - sliceH);
      out.push({ y, h: sliceH });
    }
    return out;
  }

  // Returns base64 JPEGs, top to bottom.
  async function prepareImages(file) {
    const bmp = await loadBitmap(file);
    const W = bmp.width, H = bmp.height;
    const slices = planSlices(W, H);
    const out = [];
    for (const s of slices) {
      let scale = Math.min(1, MAX_EDGE / Math.max(W, s.h), Math.sqrt(MAX_PIXELS / (W * s.h)));
      const cw = Math.round(W * scale), ch = Math.round(s.h * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, s.y, W, s.h, 0, 0, cw, ch);
      out.push(toJpegBase64(c));
    }
    if (bmp.close) bmp.close();
    return out;
  }

  // ---------- Request ----------
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

  class ReceiptError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  async function read(file, sections) {
    const key = getKey();
    if (!key) throw new ReceiptError('nokey', 'Add your API key first.');
    if (!navigator.onLine) throw new ReceiptError('offline', 'Reading a receipt needs an internet connection. Your photo wasn\'t sent — try again once you\'re online.');

    let images;
    try { images = await prepareImages(file); }
    catch (e) { throw new ReceiptError('image', 'Couldn\'t open that photo. Try taking it again.'); }

    const now = new Date();
    const today = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({ type: 'text', text: buildPrompt(sections, images.length, today) });

    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8000,
          output_config: { format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content }]
        })
      });
    } catch (e) {
      throw new ReceiptError('network', 'Couldn\'t reach Claude. Check your connection and try again.');
    }

    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || '';
      if (res.status === 401 || res.status === 403) throw new ReceiptError('badkey', 'Your API key was rejected. Check it in Receipt settings.');
      if (/credit|billing|balance/i.test(msg)) throw new ReceiptError('credit', 'Your API account is out of credit. Add some at platform.claude.com.');
      if (res.status === 429 || res.status === 529 || res.status >= 500) throw new ReceiptError('busy', 'Claude is busy right now. Try again in a minute.');
      if (res.status === 413) throw new ReceiptError('image', 'That photo is too large. Try a closer shot of just the receipt.');
      throw new ReceiptError('api', 'Couldn\'t read the receipt' + (msg ? ': ' + msg : '.'));
    }

    if (body && body.stop_reason === 'max_tokens') throw new ReceiptError('parse', 'That receipt was too long to read in one go. Try photographing it in two halves.');
    let out = null;
    const text = body && Array.isArray(body.content) && body.content.filter(c => c.type === 'text').map(c => c.text).join('');
    try { out = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) {}
    if (!out || !Array.isArray(out.lines)) throw new ReceiptError('parse', 'Claude couldn\'t make sense of that photo. Try a straighter, closer shot in good light.');
    if (!out.lines.length) throw new ReceiptError('parse', 'No items found. Is that a grocery receipt?');
    return out;
  }

  const api = { read, getKey, setKey, planSlices, buildPrompt, MODEL, ReceiptError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Receipt = api;
})(typeof self !== 'undefined' ? self : this);
