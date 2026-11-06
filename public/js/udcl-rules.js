/*
 * United Dairy Customer List (UDCL, Joe 11/1): the one customer list for every app. Shared by the screens and the server (one
 * file, copied unchanged to public/js/udcl-rules.js by npm run sync-logic; a unit test checks the two match).
 *
 * Joe 11/1: "This customer list is going to be a full customer base ... I want to be able to have route maps. Basically a map of
 * how I want the truck loaded ... see it by customer, by route, by day ... sequence the routes whenever I want to change it ...
 * print anything from any screen ... just Uniontown for now. But eventually be company-wide."
 * Joe 11/1 (the route files): "My Uniontown route menu is updated the best that I know. So the route menu in the sequence change
 * may not be accurate, so they'll have to be rebuilt ... off the current Uniontown route menu." So the Route Menu workbook is
 * where the customers, their routes, days and load sequence come from; the 2024 Route Book only fills in what the Route Menu does
 * not have (start times, run order, keys or door codes, instructions, the truck load drawing), and only where it still fits.
 *
 * Words used here:
 *   - a customer: one account (the Route Menu's Account number), with its name, chain and address;
 *   - a route day: one route on one day of the week (803 on Tuesday), with its stops in run order (the order the driver
 *     delivers), each stop's load sequence (where its product sits on the truck; 1 = loaded first, at the front), the start time,
 *     the route's instructions and its load map;
 *   - a load map: the truck seen from above, front at the top, the back door at the bottom: rows of 6 spots (3 on the left side,
 *     3 on the right, as the Route Book draws it), each holding a load sequence number; one row can be the side door.
 *
 * Everything is kept per plant (Uniontown now; every plant later), so the same list works company-wide.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UDCL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DAY_NAMES = { SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
  var SPOTS = 6;           // spots across one row of the load map (3 left, 3 right)
  var MAP_ROWS = 12;       // rows on a new load map
  var MAX_ROWS = 30;
  var MAX_STOPS = 60;      // stops on one route day
  var MAX_LINES = 5000;    // lines in one Route Menu upload
  var LIMITS = { name: 80, account: 20, chain: 12, route: 12, address: 120, city: 60, state: 4, zip: 12, phone: 40, contact: 80, keys: 120, group: 40, note: 500, notes: 2000, startTime: 20 };

  function text(v, max) {
    var t = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
    return max ? t.slice(0, max) : t;
  }
  // Excel gives numbers (803, 1196.0): keep them as plain words ("803", "1196").
  function numText(v, max) { var t = text(v, max); return /^-?\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t; }
  function dayOf(v) {
    var t = text(v).toUpperCase();
    if (t === 'THUR' || t === 'THURS') return 'THU';
    if (t === 'TUES') return 'TUE';
    t = t.slice(0, 3);
    return DAYS.indexOf(t) >= 0 ? t : '';
  }
  function dayFromName(v) {
    var t = text(v).toLowerCase();
    for (var k in DAY_NAMES) if (DAY_NAMES[k].toLowerCase() === t) return k;
    return '';
  }
  function seqOf(v) { var n = Number(v); return isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : 0; }
  // A customer's key: the account number; a customer with none goes by its name.
  function custKey(account, name) {
    var a = numText(account, LIMITS.account);
    if (a && a !== '0') return a.replace(/[^A-Za-z0-9-]/g, '');
    return 'N-' + text(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  function routeDayId(plant, route, day) { return safe(plant) + '__' + safe(route) + '__' + day; }
  function customerId(plant, key) { return safe(plant) + '__' + safe(key); }
  function safe(v) { return String(v || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60); }
  // One shared collator: String.localeCompare with options builds a new one at every call, which made sorting 5,118 customers
  // take about a second (Joe 11/2: "everything's extremely slow").
  var NUMERIC = new Intl.Collator('en', { numeric: true }), NAMES = new Intl.Collator('en');
  function byRoute(a, b) { return NUMERIC.compare(String(a), String(b)); }
  function byName(a, b) { return NAMES.compare(String(a === null || a === undefined ? '' : a), String(b === null || b === undefined ? '' : b)); }
  function dayIndex(d) { var i = DAYS.indexOf(d); return i < 0 ? 9 : i; }

  /* ---------- reading the workbooks (rows = arrays of cell values, as SheetJS sheet_to_json(header: 1) gives) ---------- */

  function findHeading(rows, words, from) {
    for (var r = from || 0; r < Math.min(rows.length, 40 + (from || 0)); r++) {
      var row = (rows[r] || []).map(function (c) { return text(c).toUpperCase(); });
      var cols = words.map(function (w) { return row.indexOf(w); });
      if (cols.every(function (c) { return c >= 0; })) return { row: r, cols: cols, cells: row };
    }
    return null;
  }

  /**
   * The Route Menu's "Customer By Route" tab: DAY, ROUTE, Chain, Account, Name, then the load sequence (the LOAD SEQ column, or the
   * column after Name when it has no heading). One line per customer per delivery day. Lines with no route are kept apart
   * (unrouted): they are not on any route day yet.
   */
  function menuStops(rows) {
    var h = findHeading(rows, ['DAY', 'ROUTE', 'NAME']) || findHeading(rows, ['DAY', 'RT', 'NAME']);
    if (!h) return null;
    var cells = h.cells, at = function (w) { return cells.indexOf(w); };
    var cDay = h.cols[0], cRoute = h.cols[1], cName = h.cols[2], cChain = at('CHAIN'), cAcct = at('ACCOUNT');
    var cSeq = at('LOAD SEQ');
    var seen = {}, out = [], unrouted = [];
    for (var r = h.row + 1; r < rows.length && out.length + unrouted.length < MAX_LINES; r++) {
      var row = rows[r] || [];
      var day = dayOf(row[cDay]), name = text(row[cName], LIMITS.name);
      if (!day || !name) continue;
      var route = numText(row[cRoute], LIMITS.route), account = numText(row[cAcct], LIMITS.account), chain = numText(row[cChain], LIMITS.chain);
      // The tab's load sequence sits in LOAD SEQ, or in the two columns after Name (the second is the one typed over).
      var seq = cSeq >= 0 ? seqOf(row[cSeq]) : (seqOf(row[cName + 2]) || seqOf(row[cName + 1]));
      var x = { day: day, route: route, account: account === '0' ? '' : account, chain: chain, // Joe 11/2: a chain of 0 is chain 0, not blank
      name: name, loadSeq: seq };
      x.key = custKey(x.account, x.name);
      var k = [x.day, x.route, x.key].join('|');
      if (seen[k]) continue;
      seen[k] = true;
      (route ? out : unrouted).push(x);
    }
    return { stops: out, unrouted: unrouted };
  }

  /** The Route Menu's "Address List" tab (no headings): account in the 3rd column, then name, street, street 2, city, state, zip. */
  function addressList(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var account = numText(row[2], LIMITS.account);
      if (!/^\d+$/.test(account) || account === '0') return;
      var street = text(row[4], LIMITS.address), street2 = text(row[5], LIMITS.address);
      out[account] = { address: street, address2: street2 && street2 !== street ? street2 : '', city: text(row[6], LIMITS.city).replace(/,$/, ''),
        state: text(row[7], LIMITS.state).toUpperCase(), zip: numText(row[8], LIMITS.zip) };
    });
    return out;
  }

  function nameKey(n) { return text(n).toUpperCase().replace(/[`'’.]/g, '').replace(/[^A-Z0-9#]+/g, ' ').trim(); }

  /** The Route Menu's "GPS Address" tab: Name, Address, City, State, Route, Lat, Lon, found by the customer's name. */
  function gpsAddresses(rows) {
    var h = findHeading(rows, ['NAME', 'ADDRESS', 'CITY']);
    if (!h) return {};
    var c = h.cells, out = {};
    for (var r = h.row + 1; r < rows.length; r++) {
      var row = rows[r] || [], name = nameKey(row[c.indexOf('NAME')]);
      if (!name) continue;
      var lat = Number(row[c.indexOf('LAT')]), lon = Number(row[c.indexOf('LON')]);
      out[name] = { address: text(row[c.indexOf('ADDRESS')], LIMITS.address), city: text(row[c.indexOf('CITY')], LIMITS.city).replace(/,$/, ''),
        state: text(row[c.indexOf('STATE')], LIMITS.state).toUpperCase(), lat: isFinite(lat) && lat ? lat : null, lon: isFinite(lon) && lon ? lon : null };
    }
    return out;
  }

  /**
   * One "Rt 803" tab of the Route Book: a block per day (the day's name in the first column), its Start Time, a line per stop
   * (Chain, Account, Name, Run Order, Load SEQ, Time IN, Time Out, Keys or Door Code), "Instructions" and the lines under it, and on
   * the right the truck drawing (Front at the top; 6 spots across, every other row; a words cell marks the side door).
   */
  function bookSheet(rows) {
    var out = {}, starts = [];
    rows.forEach(function (row, r) { if (dayFromName(row && row[0])) starts.push(r); });
    starts.forEach(function (r0, i) {
      var day = dayFromName(rows[r0][0]), end = i + 1 < starts.length ? starts[i + 1] : rows.length;
      var b = { startTime: text(String(rows[r0][7] || '').replace(/start time/i, ''), LIMITS.startTime), stops: [], instructions: [], grid: [], door: null };
      var mode = 'stops';
      for (var r = r0 + 2; r < end; r++) {
        var row = rows[r] || [];
        if (text(row[0]).toLowerCase() === 'instructions') { mode = 'notes'; continue; }
        if (mode === 'stops' && text(row[2])) b.stops.push({ account: numText(row[1], LIMITS.account), name: text(row[2], LIMITS.name), run: seqOf(row[3]), keys: text(row[8], LIMITS.keys) });
        else if (mode === 'notes') {
          var line = row.slice(0, 12).map(function (c) { return text(c); }).filter(Boolean).join(' ');
          if (line) b.instructions.push(line);
        }
        var spots = [13, 15, 17, 21, 23, 25].map(function (c) { return row[c]; });
        if (typeof spots[0] === 'string' && text(spots[0]) && !/^front$/i.test(text(spots[0]))) { if (b.door === null) b.door = b.grid.length; continue; }
        if (spots.some(function (s) { return typeof s === 'number'; })) b.grid.push(spots.map(function (s) { return seqOf(s) || null; }));
      }
      if (b.stops.length || b.grid.length || b.instructions.length || b.startTime) out[day] = b;
    });
    return out;
  }

  /** Every "Rt <route>" tab of the Route Book: { '803|TUE': {...} }. sheets = { tabName: rows }. */
  function routeBook(sheets) {
    var out = {};
    Object.keys(sheets || {}).forEach(function (name) {
      var m = /^\s*rt\s*(\d+)\s*$/i.exec(name);
      if (!m) return;
      var days = bookSheet(sheets[name]);
      Object.keys(days).forEach(function (d) { out[m[1] + '|' + d] = days[d]; });
    });
    return out;
  }

  /* ---------- run order and load maps ---------- */

  /**
   * The stops of one route day in run order, at an import. The Route Book's run order wins where it covers most of the stops.
   * Else a saved order is kept (customers new to the route day go after the stop with the next higher load sequence); else the
   * load sequence from the back door in (the highest number comes off first), then the name.
   */
  function runOrder(stops, saved, book) {
    // Joe 11/1: a new upload overrules everything. The Route Book's run numbers decide when it has them for most of the stops;
    // without them the order saved here stays (the Route Menu carries no run order); customers new to it are slotted in by load
    // sequence. Nothing saved and no Route Book: by load sequence, highest first.
    var list = stops.slice(), run = {};
    ((book && book.stops) || []).forEach(function (b) { if (b.run) run[custKey(b.account, b.name)] = b.run; });
    var hasRun = list.filter(function (s) { return run[s.key]; }).length;
    if (hasRun && hasRun * 2 >= list.length) {
      return list.sort(function (a, b) {
        var ra = run[a.key] || 999, rb = run[b.key] || 999;
        return ra - rb || b.loadSeq - a.loadSeq || byName(a.name, b.name);
      });
    }
    if (saved && saved.length) {
      var at = {};
      saved.forEach(function (k, i) { at[k] = i; });
      var kept = list.filter(function (s) { return at[s.key] !== undefined; }).sort(function (a, b) { return at[a.key] - at[b.key]; });
      list.filter(function (s) { return at[s.key] === undefined; }).sort(function (a, b) { return b.loadSeq - a.loadSeq || byName(a.name, b.name); }).forEach(function (s) {
        var i = 0;
        while (i < kept.length && kept[i].loadSeq >= s.loadSeq) i++;
        kept.splice(i, 0, s);
      });
      return kept;
    }
    return list.sort(function (a, b) { return b.loadSeq - a.loadSeq || byName(a.name, b.name); });
  }

  /** The load sequence numbers on a route day, smallest first. */
  function seqsOf(stops) {
    var s = {};
    stops.forEach(function (x) { if (x.loadSeq) s[x.loadSeq] = true; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  /**
   * A new load map for a route day: the truck's rows shared out between the load sequence numbers, front first, by how many stops
   * each has (at least one row each).
   */
  function autoMap(stops, rows) {
    var seqs = seqsOf(stops), n = Math.max(rows || MAP_ROWS, seqs.length, 1);
    var cells = [];
    if (!seqs.length) { for (var e = 0; e < n; e++) cells.push(blankRow()); return { rows: n, door: null, cells: cells }; }
    var count = seqs.map(function (q) { return stops.filter(function (s) { return s.loadSeq === q; }).length || 1; });
    var total = count.reduce(function (a, b) { return a + b; }, 0), share = count.map(function () { return 1; }), left = n - seqs.length;
    // The rows left over go one at a time to the number furthest below its fair share.
    while (left > 0) {
      var best = 0, gap = -1e9;
      share.forEach(function (sh, i) { var g = count[i] / total * n - sh; if (g > gap) { gap = g; best = i; } });
      share[best]++; left--;
    }
    seqs.forEach(function (q, i) { for (var k = 0; k < share[i]; k++) cells.push(fillRow(q)); });
    return { rows: n, door: null, cells: cells };
  }
  function blankRow() { var r = []; for (var i = 0; i < SPOTS; i++) r.push(null); return r; }
  function fillRow(q) { var r = []; for (var i = 0; i < SPOTS; i++) r.push(q); return r; }

  /** The Route Book's drawing, if every number on it is still one of the route day's load sequence numbers. */
  function bookMap(book, stops) {
    if (!book || !book.grid || !book.grid.length) return null;
    var seqs = seqsOf(stops || []), used = {};
    book.grid.forEach(function (r) { r.forEach(function (c) { if (c) used[c] = true; }); });
    if (!Object.keys(used).every(function (k) { return seqs.indexOf(Number(k)) >= 0; })) return null;
    return cleanMap({ rows: book.grid.length, door: book.door, cells: book.grid });
  }

  /** Whether every number on a saved load map is still one of the route day's load sequence numbers. */
  function mapFits(map, stops) {
    var seqs = seqsOf(stops || []), m = cleanMap(map);
    return m.cells.every(function (r) { return r.every(function (c) { return !c || seqs.indexOf(c) >= 0; }); });
  }

  /** A load map as saved: rows 1-30, 6 spots each, each spot a load sequence number or blank; the side door row or none. */
  function cleanMap(m) {
    m = m || {};
    var rows = Math.max(1, Math.min(MAX_ROWS, Math.round(Number(m.rows) || (m.cells && m.cells.length) || MAP_ROWS)));
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var src = (m.cells && m.cells[r]) || [], row = [];
      if (typeof src === 'string') src = src.split(',');
      for (var c = 0; c < SPOTS; c++) row.push(seqOf(src[c]) || null);
      cells.push(row);
    }
    var door = m.door === null || m.door === undefined || m.door === '' ? null : Math.round(Number(m.door));
    return { rows: rows, door: isFinite(door) && door >= 0 && door <= rows ? door : null, cells: cells };
  }

  /** A map as the database keeps it: each row as words ("1,1,1,,2,2"), since the database holds no list inside a list. */
  function packMap(m) {
    if (!m) return null;
    var c = cleanMap(m);
    return { rows: c.rows, door: c.door, cells: c.cells.map(function (r) { return r.map(function (v) { return v || ''; }).join(','); }) };
  }

  /** How many spots each load sequence number has on a map. */
  function mapCounts(map) {
    var n = {};
    ((map && map.cells) || []).forEach(function (r) { r.forEach(function (c) { if (c) n[c] = (n[c] || 0) + 1; }); });
    return n;
  }

  /* ---------- the lists the screens show ---------- */

  /**
   * Every delivery line: one per customer per route day, with its run order (stop number) and load sequence.
   * customers = { key: customer }, routeDays = [route day].
   */
  function lines(customers, routeDays) {
    var out = [];
    (routeDays || []).forEach(function (rd) {
      (rd.stops || []).forEach(function (s, i) {
        var c = customers[s.key] || {};
        out.push({ key: s.key, account: c.account || s.account || '', name: c.name || s.name || '', chain: c.chain || s.chain || '', route: rd.route, day: rd.day,
          stop: i + 1, loadSeq: s.loadSeq || 0, note: s.note || '', city: c.city || '', address: c.address || '', state: c.state || '', zip: c.zip || '',
          keys: c.keys || '', phone: c.phone || '', active: c.active !== false,
          palletUses: (rd.palletUses || {})[s.key] || '', caseWeeks: (rd.cases || {})[s.key] || null });
      });
    });
    return out;
  }

  /* ---------- cases per delivery (Joe 11-6-26) ----------
   * "use that information to get each store average cases, the high and then the low ... I want minimum, maximum, and average".
   * The weeks come from the Hub's Weekly Route Report (routeWeekly, MIS's weekly cases by route and store). For one customer on
   * one route day: one number per week it was delivered that day, its cases. Pallet Builder holds the customer's pallet space at
   * the number its PALLET USES picks (Joe: "if we're going to use the high number ... it'll be shaded in ... if it's more, then
   * we'll have to add"), and the standard for every customer is set on Pallet Rules.
   */
  var CASE_RULES = ['HIGH', 'LOW', 'MIDDLE', 'AVERAGE', 'LAST'];
  var CASE_RULE_NAMES = { HIGH: 'High', LOW: 'Low', MIDDLE: 'Middle', AVERAGE: 'Average', LAST: 'Last weeks average' };
  var PALLET_RULES = { standard: 'HIGH', weeks: 5, cratesPerPallet: 54, cratesPerStack: 6, dispensersPerPallet: 45, boxIsCrate: true, toteSpots: 1, newPalletEachSeq: true, under: 'KEEP', over: 'ADD' };
  function ruleOf(v) { var t = text(v).toUpperCase(); return CASE_RULES.indexOf(t) >= 0 ? t : ''; }
  function whole(v, lo, hi, dflt) { var n = Math.round(Number(v)); return isFinite(n) && n >= lo && n <= hi ? n : dflt; }
  /** Pallet Rules as saved, with anything missing or wrong put back to the standard. */
  function palletRules(v) {
    var r = v || {}, d = PALLET_RULES;
    return { standard: ruleOf(r.standard) || d.standard, weeks: whole(r.weeks, 1, 52, d.weeks),
      cratesPerPallet: whole(r.cratesPerPallet, 1, 200, d.cratesPerPallet), cratesPerStack: whole(r.cratesPerStack, 1, 20, d.cratesPerStack),
      dispensersPerPallet: whole(r.dispensersPerPallet, 1, 200, d.dispensersPerPallet), boxIsCrate: r.boxIsCrate === undefined ? d.boxIsCrate : !!r.boxIsCrate,
      toteSpots: whole(r.toteSpots, 1, 6, d.toteSpots), newPalletEachSeq: r.newPalletEachSeq === undefined ? d.newPalletEachSeq : !!r.newPalletEachSeq,
      under: r.under === 'SHRINK' ? 'SHRINK' : 'KEEP', over: r.over === 'NONE' ? 'NONE' : 'ADD' };
  }
  /**
   * weeks = [[week ending, cases], ...] (any order; a week with no delivery is not in it). Returns the numbers the screens show:
   * low, middle (the delivery in the middle), average, high, last (average of the newest `n` weeks), n deliveries, newest week.
   */
  function caseStats(weeks, n) {
    var w = (weeks || []).filter(function (x) { return x && isFinite(Number(x[1])) && Number(x[1]) > 0; })
      .map(function (x) { return [String(x[0]), Number(x[1])]; }).sort(function (a, b) { return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0; });
    if (!w.length) return null;
    var v = w.map(function (x) { return x[1]; }), sorted = v.slice().sort(function (a, b) { return a - b; });
    var mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    var sum = function (a) { return a.reduce(function (t, x) { return t + x; }, 0); };
    var lastN = v.slice(0, Math.max(1, n || PALLET_RULES.weeks));
    var r1 = function (x) { return Math.round(x * 10) / 10; };
    return { low: Math.round(sorted[0]), middle: r1(mid), average: r1(sum(v) / v.length), high: Math.round(sorted[sorted.length - 1]),
      last: r1(sum(lastN) / lastN.length), lastWeeks: lastN.length, deliveries: v.length, newest: w[0][0], oldest: w[w.length - 1][0] };
  }
  /** The number a customer's pallet space is held for: its own PALLET USES, else the standard. */
  function heldCases(stats, rule, standard) {
    if (!stats) return 0;
    var r = ruleOf(rule) || ruleOf(standard) || PALLET_RULES.standard;
    return Math.ceil({ HIGH: stats.high, LOW: stats.low, MIDDLE: stats.middle, AVERAGE: stats.average, LAST: stats.last }[r]);
  }

  var SORTS = {
    customer: function (a, b) { return byName(a.name, b.name) || dayIndex(a.day) - dayIndex(b.day) || byRoute(a.route, b.route); },
    route: function (a, b) { return byRoute(a.route, b.route) || dayIndex(a.day) - dayIndex(b.day) || a.stop - b.stop; },
    day: function (a, b) { return dayIndex(a.day) - dayIndex(b.day) || byRoute(a.route, b.route) || a.stop - b.stop; },
    account: function (a, b) { return byRoute(a.account, b.account) || dayIndex(a.day) - dayIndex(b.day); },
    city: function (a, b) { return byName(a.city, b.city) || byName(a.name, b.name) || dayIndex(a.day) - dayIndex(b.day); },
    chain: function (a, b) { return byRoute(a.chain || 'zz', b.chain || 'zz') || byName(a.name, b.name) || dayIndex(a.day) - dayIndex(b.day); }
  };

  /** The lines picked by the screen's boxes: f = { q (any words), route, day, chain, sort }. */
  function pick(list, f) {
    f = f || {};
    var words = text(f.q).toUpperCase().split(' ').filter(Boolean);
    var out = list.filter(function (x) {
      if (f.route && x.route !== f.route) return false;
      if (f.day && x.day !== f.day) return false;
      if (f.chain && x.chain !== f.chain) return false;
      if (!words.length) return true;
      var hay = [x.name, x.account, x.chain, x.city, x.address, x.route, DAY_NAMES[x.day] || ''].join(' ').toUpperCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return out.sort(SORTS[f.sort] || SORTS.customer);
  }

  /** One customer per row, with every day and route it gets a delivery ("TUE 803, FRI 803"). */
  function customerRows(customers, allLines) {
    var by = {};
    allLines.forEach(function (l) { (by[l.key] = by[l.key] || []).push(l); });
    return Object.keys(customers).map(function (k) {
      var c = customers[k], ls = (by[k] || []).sort(SORTS.day);
      return Object.assign({}, c, { key: k, deliveries: ls.map(function (l) { return { day: l.day, route: l.route, stop: l.stop, loadSeq: l.loadSeq }; }),
        days: ls.map(function (l) { return l.day; }).filter(function (d, i, a) { return a.indexOf(d) === i; }) });
    }).sort(function (a, b) { return byName(a.name, b.name); });
  }

  /** "S M T W H F S" with the delivery days filled in, as the Route Menu writes it. */
  function dayLetters(days) {
    var L = ['S', 'M', 'T', 'W', 'H', 'F', 'S'];
    return DAYS.map(function (d, i) { return days.indexOf(d) >= 0 ? L[i] : '-'; }).join(' ');
  }

  /* ---------- checking a save ---------- */

  /** A route day's stops as saved from the Route Book screen: in run order, each its customer key, load sequence and note. */
  function cleanStops(stops) {
    if (!Array.isArray(stops)) return null;
    var seen = {}, out = [];
    stops.slice(0, MAX_STOPS).forEach(function (s) {
      var key = text(s && s.key, 60);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push({ key: key, loadSeq: seqOf(s.loadSeq), note: text(s.note, LIMITS.note) });
    });
    return out;
  }

  // Joe 11/1: every place has a distribution center code (DC). A customer belongs to one; a plant's own customers start with its code.
  var DCS = [{ code: '1', name: 'Martins Ferry' }, { code: '6', name: 'Lancaster' }, { code: '7', name: 'Fairmont' }, { code: '9', name: 'Marietta' }, { code: '30', name: 'Uniontown' }, { code: '50', name: 'Charleston' }];
  var PLANT_DC = { fac_martins_ferry: '1', fac_uniontown: '30', fac_charleston: '50' };
  /** The DC code when it is one of ours ('030' and 30 are '30'), else ''. */
  // Joe 11/2: the full company list has every distribution center, also ones with no name here yet (61, 71, 142 ...): keep the number.
  function dcOf(v) { var t = numText(v, 6).replace(/^0+(?=\d)/, ''); return /^\d{1,4}$/.test(t) ? t : ''; }
  // Joe 11/3: the master file's DC column also holds route numbers. "103, 107, 112 are all just route numbers. They are not branches",
  // "anything above 80 is not a branch", and 0, 8, 11, 12 and 14 are not either. "Look at the chain and customer number to determine
  // the DC": every one of those customers is chain 0 with an account from one 4 to 5 digit series, the Marietta books (DC 9 has no
  // other customers in the file), so their branch is Marietta. The number stays as the file has it (an upload matches on it) and
  // shows under Route.
  // Route 815 is Uniontown's (Beaver County, PA; it is on the Uniontown Route Menu), not Marietta's.
  var NOT_BRANCH = { '0': 1, '8': 1, '11': 1, '12': 1, '14': 1 }, ROUTE_BRANCH = '9', ROUTE_OWNER = { '815': '30' };
  function isBranchCode(t) { return !!t && !NOT_BRANCH[t] && Number(t) <= 80; }
  /** The customer's branch (DC) code: the code itself, or Marietta for a route number; '' when blank. */
  function branchOf(v) { var t = dcOf(v); return !t || isBranchCode(t) ? t : ROUTE_OWNER[t] || ROUTE_BRANCH; }
  // Joe 11/3: "any customer that has 3 periods in front of the name is an inactive customer." An upload makes it inactive.
  function inactiveName(name) { return /^\s*\.{3}/.test(String(name || '')); }
  /** The route number the master file put in its DC column, '' when that column holds a branch or is blank. */
  function dcRoute(v) { var t = dcOf(v); return t && !isBranchCode(t) ? t : ''; }
  /** "30 Uniontown" for a branch, "51 DC 51" for a branch with no name here yet, '' for none or a route number. */
  function dcName(v) { var t = branchOf(v), d = DCS.filter(function (x) { return x.code === t; })[0]; return d ? d.code + ' ' + d.name : t ? t + ' DC ' + t : ''; }
  // The parts of a ship-to address (a checked one stays through an upload: importMenu).
  var ADDRESS_FIELDS = ['address', 'address2', 'city', 'state', 'zip', 'lat', 'lon'];
  var CUSTOMER_FIELDS = ['name', 'chain', 'group', 'dc', 'address', 'address2', 'city', 'state', 'zip', 'phone', 'contact', 'keys', 'notes'];
  function cleanCustomer(c) {
    var out = {};
    CUSTOMER_FIELDS.forEach(function (k) {
      if (c && c[k] !== undefined) out[k] = k === 'notes' ? String(c[k] || '').trim().slice(0, LIMITS.notes) : k === 'dc' ? dcOf(c[k]) : (k === 'chain' || k === 'zip' ? numText(c[k], LIMITS[k]) : text(c[k], LIMITS[k === 'address2' ? 'address' : k]));
    });
    if (out.state) out.state = out.state.toUpperCase();
    if (c && c.lat !== undefined) { var la = Number(c.lat); out.lat = isFinite(la) && la ? la : null; }
    if (c && c.lon !== undefined) { var lo = Number(c.lon); out.lon = isFinite(lo) && lo ? lo : null; }
    if (c && c.active !== undefined) out.active = c.active !== false;
    return out;
  }

  /**
   * Joe 11/2: "Anything that says PO box or mailbox is not a true address." A post office box, mailbox, rural route or R.D. box, or
   * an address in care of someone else (the schools' "Nutrition Inc. c/o") is where mail goes, not where the truck goes.
   */
  function notStreet(a) {
    return /(\bP\.?\s*O\.?\s*(BOX|BX|DRAWER)\b|\bPOST\s+OFFICE\b|\bMAIL\s*BOX\b|\bPMB\b|\bC\s*\/\s*O\b|\bCARE\s+OF\b|\bR\.?\s*R\.?\s*#?\s*\d+[,\s]+BOX\b|\bR\.?\s*D\.?\s*#?\s*\d*[,\s]+BOX\b|^\s*BOX\s+\d)/i.test(String(a || ''));
  }

  /**
   * Joe 11/2: the company's full customer list, every distribution center. Two layouts:
   *  - DC, CHAIN, ACCOUNT, NAME, then the street, a second street (often the same again), city, state and zip with no headings;
   *  - the master file ("All Customers - One Tab"): DC, Chain, Account, Customer, Original street, Original second line, Original
   *    city, Original state, Original ZIP, Matched address, Address changed?, Latitude, Longitude, Match status, Coordinate source,
   *    Review notes ... Rows with no DC or account (map points only) are skipped. Chain 0 is chain 0.
   * One row per customer: { dc, chain, account, name, address, address2, city, state, zip, lat, lon, check, checkNote, proposed, gpsFrom }.
   */
  function fullListRows(rows) {
    rows = rows || [];
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var cells = (rows[r] || []).map(function (c) { return text(c).toUpperCase(); });
      var at = function (names, dflt) { for (var i = 0; i < names.length; i++) { var x = cells.indexOf(names[i]); if (x >= 0) return x; } return dflt === undefined ? -1 : dflt; };
      var dc = at(['DC']), acct = at(['ACCOUNT']), name = at(['NAME', 'CUSTOMER']), chain = at(['CHAIN']);
      if (dc < 0 || acct < 0 || name < 0) continue;
      // A sheet of looked-up ship-to addresses (it has a Confidence column) is not the master list: the Master Customer List reads it as checked addresses.
      if (cells.indexOf('CONFIDENCE') >= 0) return [];
      // A file with address headings is read by them; only a file with none falls back to the columns after the name.
      var named = at(['ORIGINAL STREET', 'ADDRESS', 'STREET', 'ADDRESS 1', 'STREET 1', 'CITY', 'ORIGINAL CITY']) >= 0, after = function (n) { return named ? -1 : name + n; };
      var a1 = at(['ORIGINAL STREET', 'ADDRESS', 'STREET', 'ADDRESS 1', 'STREET 1'], after(1)), a2 = at(['ORIGINAL SECOND LINE', 'SECOND LINE', 'ADDRESS 2', 'STREET 2'], after(2)),
        city = at(['ORIGINAL CITY', 'CITY'], after(3)), st = at(['ORIGINAL STATE', 'STATE', 'ST'], after(4)), zip = at(['ORIGINAL ZIP', 'ZIP', 'ZIP CODE'], after(5)),
        lat = at(['LATITUDE', 'LAT']), lon = at(['LONGITUDE', 'LON', 'LNG']), check = at(['MATCH STATUS']), note = at(['REVIEW NOTES']), prop = at(['MATCHED ADDRESS']),
        changed = at(['ADDRESS CHANGED?']), from = at(['COORDINATE SOURCE']),
        phone = at(['PHONE', 'PHONE NUMBER', 'TELEPHONE', 'PHONE #']), contact = at(['CONTACT', 'CONTACT NAME']), group = at(['GROUP']), status = at(['ACTIVE', 'STATUS', 'ACTIVE / INACTIVE', 'ACTIVE/INACTIVE']);
      var cell = function (row, i, max) { return i >= 0 ? text(row[i], max) : ''; };
      var num = function (row, i) { var v = i >= 0 ? Number(row[i]) : NaN; return isFinite(v) && v ? v : null; };
      var out = [];
      for (var i = r + 1; i < rows.length; i++) {
        var row = rows[i] || [], account = numText(row[acct], LIMITS.account), nm = text(row[name], LIMITS.name), d = numText(row[dc], 6).replace(/^0+(?=\d)/, '');
        if (!account || !nm || !d) continue;
        var s1 = a1 >= 0 ? text(row[a1], LIMITS.address) : '', s2 = a2 >= 0 ? text(row[a2], LIMITS.address) : '';
        var x = { dc: d, chain: chain >= 0 ? numText(row[chain], LIMITS.chain) : '', account: account, name: nm, address: s1, address2: s2 && s2.toUpperCase() !== s1.toUpperCase() ? s2 : '',
          city: city >= 0 ? text(row[city], LIMITS.city) : '', state: st >= 0 ? text(row[st], LIMITS.state).toUpperCase() : '', zip: zip >= 0 ? numText(row[zip], LIMITS.zip) : '' };
        if (lat >= 0) { x.lat = num(row, lat); x.lon = num(row, lon); }
        if (phone >= 0 && cell(row, phone, LIMITS.phone)) x.phone = cell(row, phone, LIMITS.phone);
        if (contact >= 0 && cell(row, contact, LIMITS.contact)) x.contact = cell(row, contact, LIMITS.contact);
        if (group >= 0 && cell(row, group, LIMITS.group)) x.group = cell(row, group, LIMITS.group);
        if (status >= 0) { var sv = cell(row, status, 20).toUpperCase(); if (/^(INACTIVE|NO|N|FALSE|0)$/.test(sv)) x.inactive = true; else if (/^(ACTIVE|YES|Y|TRUE|1)$/.test(sv)) x.inactive = false; }
        if (check >= 0) { x.check = cell(row, check, 60); x.checkNote = cell(row, note, 300); x.gpsFrom = cell(row, from, 80); x.proposed = cell(row, changed, 40).toUpperCase() === 'YES' ? cell(row, prop, 200) : ''; }
        out.push(x);
      }
      return out;
    }
    return [];
  }

  /**
   * A sheet of checked ship-to addresses (Master Customer List): headings Account, Street (or Ship-to street, Address), City, State, Zip,
   * and if there, Street 2, Confidence and Source. One row per customer; rows with no account or street are skipped.
   */
  function checkedAddressRows(rows) {
    rows = rows || [];
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var cells = (rows[r] || []).map(function (c) { return text(c).toUpperCase(); });
      var col = function (names) { for (var i = 0; i < names.length; i++) { var at = cells.indexOf(names[i]); if (at >= 0) return at; } return -1; };
      var acct = col(['ACCOUNT', 'ACCT']), street = col(['SHIP-TO STREET', 'SHIP TO STREET', 'STREET', 'ADDRESS']), city = col(['CITY']);
      if (acct < 0 || street < 0 || city < 0) continue;
      var st = col(['STATE', 'ST']), zip = col(['ZIP']), s2 = col(['STREET 2', 'ADDRESS 2']), conf = col(['CONFIDENCE']), src = col(['SOURCE', 'WHERE IT CAME FROM']);
      // Joe 11/2: every DC is on the list, and account numbers repeat across DCs: read the DC (and name, chain) when the sheet has them.
      var dcc = col(['DC']), nmc = col(['CUSTOMER', 'NAME']), chc = col(['CHAIN']);
      var out = [];
      for (var i = r + 1; i < rows.length; i++) {
        var row = rows[i] || [], key = numText(row[acct], LIMITS.account), a = text(row[street], LIMITS.address);
        if (!key || !a) continue;
        out.push({ key: key, address: a, address2: s2 >= 0 ? text(row[s2], LIMITS.address) : '', city: text(row[city], LIMITS.city), state: st >= 0 ? text(row[st], LIMITS.state).toUpperCase() : '',
          zip: zip >= 0 ? numText(row[zip], LIMITS.zip) : '', confidence: conf >= 0 ? text(row[conf], 20) : '', source: src >= 0 ? text(row[src], 200) : '',
          dc: dcc >= 0 ? numText(row[dcc], 6).replace(/^0+(?=\d)/, '') : '', name: nmc >= 0 ? text(row[nmc], LIMITS.name) : '', chain: chc >= 0 ? numText(row[chc], LIMITS.chain) : '' });
      }
      return out;
    }
    return [];
  }

  /** One line of the customer's address, for lists and print. */
  function addressLine(c) {
    c = c || {};
    var cityLine = [text(c.city), [text(c.state), text(c.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [text(c.address), text(c.address2), cityLine].filter(Boolean).join(', ');
  }

  return { mapFits: mapFits, DAYS: DAYS, DAY_NAMES: DAY_NAMES, SPOTS: SPOTS, MAP_ROWS: MAP_ROWS, MAX_ROWS: MAX_ROWS, MAX_STOPS: MAX_STOPS, MAX_LINES: MAX_LINES, LIMITS: LIMITS,
    CUSTOMER_FIELDS: CUSTOMER_FIELDS, DCS: DCS, PLANT_DC: PLANT_DC, dcOf: dcOf, branchOf: branchOf, dcRoute: dcRoute, dcName: dcName, inactiveName: inactiveName, text: text, numText: numText, dayOf: dayOf, dayFromName: dayFromName, seqOf: seqOf, custKey: custKey, nameKey: nameKey,
    routeDayId: routeDayId, customerId: customerId, byRoute: byRoute, byName: byName, dayIndex: dayIndex,
    menuStops: menuStops, addressList: addressList, gpsAddresses: gpsAddresses, bookSheet: bookSheet, routeBook: routeBook,
    runOrder: runOrder, seqsOf: seqsOf, autoMap: autoMap, bookMap: bookMap, cleanMap: cleanMap, packMap: packMap, mapCounts: mapCounts,
    lines: lines, SORTS: SORTS, pick: pick, customerRows: customerRows, dayLetters: dayLetters, cleanStops: cleanStops, cleanCustomer: cleanCustomer, addressLine: addressLine, notStreet: notStreet, checkedAddressRows: checkedAddressRows, fullListRows: fullListRows, ADDRESS_FIELDS: ADDRESS_FIELDS,
    CASE_RULES: CASE_RULES, CASE_RULE_NAMES: CASE_RULE_NAMES, PALLET_RULES: PALLET_RULES, ruleOf: ruleOf, palletRules: palletRules, caseStats: caseStats, heldCases: heldCases };
});
