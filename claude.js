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

  // Send photos and/or instructions; get back JSON matching `schema`.
  //   files:   File objects, in order (may be empty)
  //   slice:   cut tall photos into overlapping sections (receipts)
  //   prompt:  (imageCount) => instruction text
  //   what:    'receipt' | 'recipe' | 'photo' | 'ad', for error messages
  //   tools:   server tools Claude may use, e.g. web_fetch to read a store's flyer
  //   stream:  stream the reply, which keeps a long request's connection alive
  // Files can be photos or PDFs (a store's ad saved from its website or email).
  async function ask({ files, slice, prompt, schema, what, maxTokens, tools, stream }) {
    files = files || [];
    const key = getKey();
    if (!key) throw new AIError('nokey', 'Add your API key first.');
    if (!navigator.onLine) throw new AIError('offline', `Reading ${what === 'ad' ? 'the ads' : 'a ' + what} needs an internet connection. Nothing was sent. Try again once you're online.`);

    const content = [];
    let images = 0;
    try {
      for (const f of files) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) {
          if (f.size > 25e6) throw new AIError('image', 'That PDF is too large to send. Try a smaller file or screenshots of the pages.');
          content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileBase64(f) } });
        } else {
          for (const data of await prepareImage(f, slice)) {
            content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
            images++;
          }
        }
      }
    } catch (e) {
      if (e instanceof AIError) throw e;
      throw new AIError('image', 'Couldn\'t open that file. Try it again.');
    }
    if (images > MAX_IMAGES) throw new AIError('image', `That's too many photos at once. Try ${what === 'recipe' ? 'up to 4 pages' : what === 'receipt' ? 'a single receipt' : 'up to 4 photos'}.`);
    content.push({ type: 'text', text: prompt(content.length) });
    const messages = [{ role: 'user', content }];
    const request = { model: MODEL, max_tokens: maxTokens || 8000, output_config: { format: { type: 'json_schema', schema } } };
    if (tools && tools.length) request.tools = tools;

    // Server tools (like fetching a web page) can pause a long turn; resume it.
    let body = null;
    for (let round = 0; round < 5; round++) {
      body = await send(key, { ...request, messages }, what, stream);
      if (body.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: body.content });
    }

    if (body && body.stop_reason === 'max_tokens') {
      throw new AIError('parse', what === 'receipt'
        ? 'That receipt was too long to read in one go. Try photographing it in two halves.'
        : what === 'ad' ? 'That ad was too long to read in one go.'
        : 'That was too much to read in one go. Try fewer pages at a time.');
    }
    // The answer is the last text block that parses (earlier text may be
    // Claude saying what it's about to fetch).
    const texts = (body && Array.isArray(body.content) ? body.content : []).filter(c => c.type === 'text').map(c => c.text);
    const tries = [texts.join('')].concat(texts.slice().reverse());
    for (const t of tries) {
      try { return JSON.parse(String(t || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) {}
    }
    throw new AIError('parse', what === 'ad'
      ? 'Claude couldn\'t make sense of the ad. Try again later.'
      : 'Claude couldn\'t make sense of that photo. Try a straighter, closer shot in good light.');
  }

  async function fileBase64(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function dropped(started) {
    // A failure after a long wait is a dropped connection, not a bad network.
    return (Date.now() - started) > 20000
      ? new AIError('network', 'The connection dropped while Claude was still reading. This can happen if the screen turns off or you switch apps. Try again and keep Inventaire open.')
      : new AIError('network', 'Couldn\'t reach Claude. Check your connection and try again.');
  }

  async function send(key, payload, what, stream) {
    const started = Date.now();
    if (stream) payload = { ...payload, stream: true };
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
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw dropped(started);
    }
    if (res.ok && stream) return readStream(res, started);
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
    return body || {};
  }

  // Rebuild a full message from server-sent events, so a streamed reply
  // looks the same as a normal one (including tool blocks, for resuming).
  async function readStream(res, started) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const msg = { content: [], stop_reason: null };
    const json = {};
    let buf = '';
    const handle = ev => {
      if (ev.type === 'content_block_start') {
        const b = { ...ev.content_block };
        if (b.type === 'text') b.text = b.text || '';
        if (b.type === 'server_tool_use' || b.type === 'tool_use') json[ev.index] = '';
        msg.content[ev.index] = b;
      } else if (ev.type === 'content_block_delta') {
        const b = msg.content[ev.index], d = ev.delta || {};
        if (!b) return;
        if (d.type === 'text_delta') b.text += d.text;
        else if (d.type === 'input_json_delta') json[ev.index] += d.partial_json;
      } else if (ev.type === 'content_block_stop') {
        if (json[ev.index] != null) {
          try { if (json[ev.index]) msg.content[ev.index].input = JSON.parse(json[ev.index]); } catch (e) {}
          delete json[ev.index];
        }
      } else if (ev.type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) msg.stop_reason = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        const t = ev.error && ev.error.type;
        throw new AIError(t === 'overloaded_error' ? 'busy' : 'api',
          t === 'overloaded_error' ? 'Claude is busy right now. Try again in a minute.' : 'Something went wrong while Claude was reading. Try again.');
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
          if (data) { let ev = null; try { ev = JSON.parse(data); } catch (e) {} if (ev) handle(ev); }
        }
      }
    } catch (e) {
      if (e instanceof AIError) throw e;
      throw dropped(started);
    }
    if (!msg.stop_reason) throw dropped(started); // stream ended early
    msg.content = msg.content.filter(Boolean);
    return msg;
  }

  const api = { ask, getKey, setKey, planSlices, MODEL, AIError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Claude = api;
})(typeof self !== 'undefined' ? self : this);
