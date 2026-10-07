// Inventaire suggestion engine.
//
// Learns from completed trips (state.history) and answers three questions:
//   1. How much does each item get used? (sorts tiles inside each category)
//   2. What is probably due this trip? (the "Suggested" row)
//   3. Is today a day for a wild card? (one in-season item outside your usual)
//
// The logic is deliberately skeptical: one item bought a lot in a single
// week is a streak, not a habit. An item has to show up across weeks before
// it gets suggested, a habit that stops fades out instead of nagging forever,
// and fresh produce is weighed against what's in season (Northern US).

(function (root) {
  const DAY = 864e5;

  // Peak months (1 = Jan) for fresh produce in the northern US.
  // Items not listed here (onions, bananas, milk...) are treated as year-round.
  const SEASONS = {
    'asparagus': [4, 5, 6],
    'rhubarb': [5, 6],
    'strawberr': [6, 7],
    'cherr': [6, 7],
    'blueberr': [7, 8],
    'raspberr': [7, 8],
    'berries': [6, 7, 8],
    'peas': [5, 6],
    'radish': [5, 6, 9, 10],
    'salad greens': [5, 6, 9, 10],
    'lettuce': [5, 6, 9, 10],
    'arugula': [5, 6, 9, 10],
    'spinach': [4, 5, 9, 10],
    'zucchini': [6, 7, 8, 9],
    'summer squash': [6, 7, 8, 9],
    'cucumber': [7, 8, 9],
    'green beans': [7, 8, 9],
    'tomato': [7, 8, 9],
    'bell pepper': [7, 8, 9, 10],
    'eggplant': [7, 8, 9],
    'corn': [7, 8, 9],
    'basil': [7, 8, 9],
    'watermelon': [7, 8],
    'cantaloupe': [7, 8, 9],
    'melon': [7, 8, 9],
    'peach': [7, 8],
    'nectarine': [7, 8],
    'plum': [8, 9],
    'grape': [8, 9, 10],
    'apple': [9, 10, 11],
    'pear': [9, 10, 11],
    'broccoli': [6, 9, 10, 11],
    'cauliflower': [9, 10, 11],
    'beet': [8, 9, 10, 11],
    'kale': [9, 10, 11, 12],
    'brussels sprouts': [10, 11, 12],
    'squash': [9, 10, 11, 12],
    'pumpkin': [9, 10, 11],
    'sweet potato': [10, 11, 12],
    'leek': [9, 10, 11, 12],
    'parsnip': [10, 11, 12, 1, 2],
    'cranberr': [10, 11, 12],
    'pomegranate': [10, 11, 12],
    'persimmon': [10, 11, 12],
    'clementine': [11, 12, 1, 2],
    'orange': [12, 1, 2, 3],
    'grapefruit': [12, 1, 2, 3],
    'mango': [4, 5, 6, 7]
  };

  // Processed forms don't follow the seasons.
  const NOT_FRESH = /\b(frozen|canned|dried|juice|jam|sauce|puree|purée|chips|pie)\b/i;

  // Wild-card pool: seasonal things a person might not think to buy.
  // Your own produce staples are added to the pool automatically.
  const WILD = [
    ['Asparagus', 'Produce', [4, 5, 6], 'Spring asparagus is short and sweet'],
    ['Rhubarb', 'Produce', [5, 6], 'Only around for a few weeks'],
    ['Strawberries', 'Produce', [6, 7], 'Local berries are at their best'],
    ['Cherries', 'Produce', [6, 7], 'Cherry season is brief'],
    ['Snap peas', 'Produce', [5, 6], 'Sweetest right now'],
    ['Radishes', 'Produce', [5, 6, 9, 10], 'Crisp and peppery this time of year'],
    ['Sweet corn', 'Produce', [7, 8, 9], 'Peak corn season'],
    ['Peaches', 'Produce', [7, 8], 'Peach season is short'],
    ['Watermelon', 'Produce', [7, 8], 'Peak summer melon'],
    ['Heirloom tomatoes', 'Produce', [8, 9], 'Late-summer tomatoes are the best of the year'],
    ['Eggplant', 'Produce', [7, 8, 9], 'In season now'],
    ['Plums', 'Produce', [8, 9], 'Late-summer stone fruit'],
    ['Concord grapes', 'Produce', [9, 10], 'Only in early fall'],
    ['Honeycrisp apples', 'Produce', [9, 10, 11], 'Fresh-picked apple season'],
    ['Pears', 'Produce', [9, 10, 11], 'Fall pears are at their peak'],
    ['Delicata squash', 'Produce', [9, 10, 11], 'Roasts in 20 minutes, no peeling'],
    ['Butternut squash', 'Produce', [9, 10, 11, 12], 'Peak winter squash'],
    ['Brussels sprouts', 'Produce', [10, 11, 12], 'Sweeter after the first frost'],
    ['Sweet potatoes', 'Produce', [10, 11, 12], 'Freshly harvested'],
    ['Leeks', 'Produce', [9, 10, 11, 12], 'Great for soups this time of year'],
    ['Cranberries', 'Produce', [10, 11, 12], 'Fresh ones only show up in fall'],
    ['Pomegranate', 'Produce', [10, 11, 12], 'In season through the holidays'],
    ['Parsnips', 'Produce', [11, 12, 1, 2], 'Cold-weather sweetness'],
    ['Clementines', 'Produce', [11, 12, 1], 'Citrus season is starting'],
    ['Blood oranges', 'Produce', [1, 2, 3], 'Winter citrus at its best'],
    ['Grapefruit', 'Produce', [12, 1, 2, 3], 'Peak winter citrus'],
    ['Apple cider', 'Fridge', [9, 10, 11], 'Fresh-pressed this time of year'],
    ['Pumpkin puree', 'Pantry', [10, 11], 'Pumpkin bread season'],
    ['Eggnog', 'Fridge', [12], 'Only around in December'],
    ['Mangoes', 'Produce', [4, 5, 6, 7], 'Mango season']
  ];

  function seasonKey(name) {
    if (NOT_FRESH.test(name)) return null;
    const low = name.toLowerCase();
    let best = null;
    for (const k of Object.keys(SEASONS)) {
      // Whole words only, allowing plurals: "corn" but not "cornstarch".
      const re = new RegExp('\\b' + k.replace(/ /g, '\\s+') + '(s|es|y|ies)?\\b');
      if (re.test(low) && (!best || k.length > best.length)) best = k;
    }
    return best;
  }

  // 'peak' | 'shoulder' | 'off' | null (year-round)
  function seasonOf(name, month) {
    const k = seasonKey(name);
    if (!k) return null;
    const months = SEASONS[k];
    if (months.includes(month)) return 'peak';
    const prev = month === 1 ? 12 : month - 1;
    const next = month === 12 ? 1 : month + 1;
    if (months.includes(prev) || months.includes(next)) return 'shoulder';
    return 'off';
  }

  const SEASON_WEIGHT = { peak: 1.15, shoulder: 1, off: 0.5 };

  function dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // How "due" an item is, given how far through its usual interval we are.
  // Not due yet -> ramps up near the interval -> holds -> fades if the habit
  // seems to have stopped, so a lapsed item stops being pushed.
  function dueCurve(r) {
    if (r < 0.7) return 0;
    if (r < 1) return (r - 0.7) / 0.3;
    if (r <= 2.5) return 1;
    if (r <= 5) return 1 - ((r - 2.5) / 2.5) * 0.8;
    return Math.max(0, 0.2 * (1 - (r - 5) / 3));
  }

  // Small deterministic RNG so the wild card stays put until the next trip.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function purchasesByItem(history, now) {
    const map = new Map();
    for (const trip of history || []) {
      if (!trip || !Array.isArray(trip.items) || trip.date > now) continue;
      for (const it of trip.items) {
        if (!map.has(it.name)) map.set(it.name, []);
        map.get(it.name).push(trip.date);
      }
    }
    for (const dates of map.values()) dates.sort((a, b) => a - b);
    return map;
  }

  function analyze(state, now) {
    now = now || Date.now();
    const month = new Date(now).getMonth() + 1;
    const history = state.history || [];
    const buys = purchasesByItem(history, now);

    const sectionOf = new Map();
    state.sections.forEach(sec => sec.items.forEach(i => sectionOf.set(i, sec.name)));

    // 1. Usage: recent purchases count more (60-day half-life).
    const usage = new Map();
    for (const [name, dates] of buys) {
      let u = 0;
      for (const d of dates) u += Math.pow(0.5, (now - d) / DAY / 60);
      usage.set(name, u);
    }

    // History span, for "you only ever buy this in summer" learning.
    const firstTrip = history.reduce((m, t) => Math.min(m, t.date), now);
    const historyDays = (now - firstTrip) / DAY;

    // 2. Suggestions.
    const suggestions = [];
    for (const [name, all] of buys) {
      if (!sectionOf.has(name)) continue;
      const dates = all.filter(d => now - d <= 365 * DAY);
      // One purchase per calendar day.
      const days = [];
      for (const d of dates) if (!days.length || dayKey(days[days.length - 1]) !== dayKey(d)) days.push(d);
      const n = days.length;
      if (n < 2) continue; // bought once: not a pattern yet

      const gaps = [];
      for (let i = 1; i < n; i++) gaps.push((days[i] - days[i - 1]) / DAY);
      const span = Math.max((now - days[0]) / DAY, 28);
      const longRun = span / n;
      const interval = Math.max(2, Math.sqrt(median(gaps) * longRun));

      // Evidence: how many times, and spread across how much time.
      // Three buys in one week is a streak; three buys over a month is a habit.
      const spread = (days[n - 1] - days[0]) / DAY;
      const confidence = Math.min(1, spread / 21) * Math.min(1, (n - 1) / 3);

      const since = (now - days[n - 1]) / DAY;
      const ratio = since / interval;
      const due = dueCurve(ratio);
      if (!due) continue;

      const season = seasonOf(name, month);
      let seasonW = season ? SEASON_WEIGHT[season] : 1;

      // Personal seasonality: with most of a year of history, if you've never
      // bought this within a month of now, you probably don't this time of year.
      if (historyDays > 300 && n >= 4) {
        const near = dates.some(d => {
          const m = new Date(d).getMonth() + 1;
          const diff = Math.min(Math.abs(m - month), 12 - Math.abs(m - month));
          return diff <= 1;
        });
        if (!near) seasonW *= 0.5;
      }

      const score = due * confidence * seasonW;
      if (score < 0.4) continue;

      const every = Math.round(interval);
      const ago = Math.round(since);
      let reason = ratio > 2.5
        ? `Usually every ~${every} days · it's been ${ago}`
        : `Every ~${every} days · last ${ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'}`;
      if (season === 'peak') reason += ' · in season';

      suggestions.push({ name, section: sectionOf.get(name), score, reason });
    }
    suggestions.sort((a, b) => b.score - a.score);
    suggestions.length = Math.min(suggestions.length, 8);

    // 3. Wild card: roughly one trip in three, stable until the next trip.
    let wildcard = null;
    const r = rng(history.length * 7919 + month * 31 + 17);
    if (r() < 0.35) {
      const recent = name => (buys.get(name) || []).some(d => now - d < 120 * DAY);
      const taken = new Set(suggestions.map(s => s.name));
      const pool = [];
      for (const [name, section, months, note] of WILD) {
        if (months.includes(month)) pool.push({ name, section, note });
      }
      const produce = state.sections.find(s => s.name === 'Produce');
      if (produce) for (const name of produce.items) {
        if (seasonOf(name, month) === 'peak') pool.push({ name, section: 'Produce', note: 'In season now' });
      }
      const fresh = pool.filter(p => !taken.has(p.name) && !recent(p.name));
      // Prefer things you've never bought at all.
      const never = fresh.filter(p => !buys.has(p.name));
      const pick = never.length ? never : fresh;
      if (pick.length) wildcard = pick[Math.floor(r() * pick.length)];
    }

    return { usage, suggestions, wildcard };
  }

  // Most-used first; items with no history keep their original order.
  function sortItems(items, usage) {
    return items
      .map((name, i) => ({ name, i, u: usage.get(name) || 0 }))
      .sort((a, b) => (b.u - a.u) || (a.i - b.i))
      .map(x => x.name);
  }

  const api = { analyze, sortItems, seasonOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Suggest = api;
})(typeof self !== 'undefined' ? self : this);
