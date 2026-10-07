// Inventaire's connection to the Claude API, shared by the receipt and recipe
// readers. Uses the person's own API key, which is stored only on this device
// and never included in backups.
//
// Photos are resized before sending. Very tall photos (long receipts) are
// sliced into overlapping sections first, because the API shrinks any image
// whose long edge exceeds 2576 px, and a whole receipt shrunk that far is too
// small to read.

(function (root) {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-5-5';
  const KEY_STORE = 'inventaire-api-key';

  const MAX_EDGE = 2576;          // API's high-resolution long-edge limit
  const MAX_PIXELS = 3.6e6;       // stays under the per-image visual token cap
  const SLICE_ASPECT = 1.6;       // slice anything taller than this (height / width)
  const OVERLAP = 0.07;           // share of each slice repeated in the next
  const MAX_IMAGES = 12;

  // ---------- API key ----------
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

  // One photo -> base64 JPEGs, top to bottom (one per slice).
  async function prepareImage(file, slice) {
    const bmp = await loadBitmap(file);
    const W = bmp.width, H = bmp.height;
    const slices = slice ? planSlices(W, H) : [{ y: 0, h: H }];
    const out = [];
    for (const s of slices) {
      const scale = Math.min(1, MAX_EDGE / Math.max(W, s.h), Math.sqrt(MAX_PIXELS / (W * s.h)));
      const cw = Math.round(W * scale), ch = Math.round(s.h * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, s.y, W, s.h, 0, 0, cw, ch);
      out.push(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
    }
    if (bmp.close) bmp.close();
    return out;
  }

  class AIError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // Send photos plus instructions; get back JSON matching `schema`.
  //   files:   File objects, in order
  //   slice:   cut tall photos into overlapping sections (receipts)
  //   prompt:  (imageCount) => instruction text
  //   what:    'receipt' | 'recipe', for error messages
  async function ask({ files, slice, prompt, schema, what, maxTokens }) {
    const key = getKey();
    if (!key) throw new AIError('nokey', 'Add your API key first.');
    if (!navigator.onLine) throw new AIError('offline', `Reading a ${what} needs an internet connection. Nothing was sent. Try again once you're online.`);

    let images = [];
    try { for (const f of files) images = images.concat(await prepareImage(f, slice)); }
    catch (e) { throw new AIError('image', 'Couldn\'t open that photo. Try taking it again.'); }
    if (images.length > MAX_IMAGES) throw new AIError('image', `That's too many photos at once. Try ${what === 'recipe' ? 'up to 4 pages' : 'a single receipt'}.`);

    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({ type: 'text', text: prompt(images.length) });

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
          max_tokens: maxTokens || 8000,
          output_config: { format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content }]
        })
      });
    } catch (e) {
      throw new AIError('network', 'Couldn\'t reach Claude. Check your connection and try again.');
    }

    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || '';
      if (res.status === 401 || res.status === 403) throw new AIError('badkey', 'Your API key was rejected. Check it under API key.');
      if (/credit|billing|balance/i.test(msg)) throw new AIError('credit', 'Your API account is out of credit. Add some at platform.claude.com.');
      if (res.status === 429 || res.status === 529 || res.status >= 500) throw new AIError('busy', 'Claude is busy right now. Try again in a minute.');
      if (res.status === 413) throw new AIError('image', `That photo is too large. Try a closer shot of just the ${what}.`);
      throw new AIError('api', `Couldn't read the ${what}` + (msg ? ': ' + msg : '.'));
    }

    if (body && body.stop_reason === 'max_tokens') {
      throw new AIError('parse', what === 'receipt'
        ? 'That receipt was too long to read in one go. Try photographing it in two halves.'
        : 'That was too much to read in one go. Try fewer pages at a time.');
    }
    const text = body && Array.isArray(body.content) && body.content.filter(c => c.type === 'text').map(c => c.text).join('');
    try { return JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch (e) { throw new AIError('parse', 'Claude couldn\'t make sense of that photo. Try a straighter, closer shot in good light.'); }
  }

  const api = { ask, getKey, setKey, planSlices, MODEL, AIError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Claude = api;
})(typeof self !== 'undefined' ? self : this);
