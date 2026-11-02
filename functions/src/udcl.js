/*
 * United Dairy Customer List (UDCL, Joe 11/1): the server side. One call, `customerList`, {op, plant, ...}. Its own app (Joe 11/1:
 * "I would really like it separated ... Still want the bridge"); Operations reads the same records for its Sales app and drivers' phone. The rules it shares with
 * the screens are in udcl-rules.js.
 *
 * Joe 11/1: "instead of having it stored in [UDPO], I want to have it stored in this program ... All still on the Firebase
 * platform ... All three of these are going to be bridged together." and "Now, are you going to keep this on the Firebase that we
 * have, correct?" So the list lives in Operations's Firebase project, in the company's (main) database, apart from the plants'
 * own databases, one record per customer and one per route day, each marked with its plant:
 *
 *   udclCustomers/<plant>__<account>          the customer: name, chain, address, phone, keys or door code, notes
 *   udclRouteDays/<plant>__<route>__<DAY>     the route day: stops in run order (customer, load sequence, stop note), start time,
 *                                              the route's instructions, the load map, rev (each save adds 1)
 *   udclLog/<id>                              who changed what, when (before and after)
 *   private/udcl_<plant>                      the last import: file name, when, by whom, the counts
 *
 * Who may do what (the same rule as the load order on Route Master): anyone on the Users list who may work at the plant sees and
 * prints; an Administrator or Manager changes the run order, load sequence, load map, instructions and customers; only an
 * Administrator imports the Route Menu workbook.
 *
 * The bridges: the Sales app's Customers card reads its lines from here once a plant has a list here (salescustomers.js
 * forSales), and the drivers' phone (Route Check-In) shows a route day's stops and instructions from here (phone.js routeBook).
 */
'use strict';

const L = require('./people');
const U = require('./udcl-rules');
const { safeIdPart } = L;

const CUSTOMERS = 'udclCustomers';
const ROUTE_DAYS = 'udclRouteDays';
const LOG = 'udclLog';
const EDIT_ROLES = ['ADMINISTRATOR', 'ADMIN', 'MANAGER'];

class UdclError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new UdclError(code, message); };
const plantName = (id) => (L.PLANTS.find(p => p.id === id) || {}).name || id;

async function personOf(db, email) {
  const s = await db.collection('users').doc(safeIdPart(email)).get();
  return s.exists ? s.data() : null;
}
function rightsOf(person) {
  const active = !!(person && String(person.status || '').toUpperCase() === 'ACTIVE');
  return { view: active, edit: active && (L.isAdmin(person) || L.hasRole(person, EDIT_ROLES)), importList: active && L.isAdmin(person) };
}

// The map comes back as rows of numbers (the database keeps each row as words, packMap).
const unpack = (rd) => (rd && rd.map ? Object.assign({}, rd, { map: U.cleanMap(rd.map) }) : rd);

async function readPlant(db, plant) {
  const [cs, rs, meta] = await Promise.all([
    db.collection(CUSTOMERS).where('plant', '==', plant).get(),
    db.collection(ROUTE_DAYS).where('plant', '==', plant).get(),
    db.collection('private').doc('udcl_' + plant).get()
  ]);
  const customers = {};
  cs.docs.forEach(d => { const c = d.data(); customers[c.key] = c; });
  const routeDays = rs.docs.map(d => unpack(d.data())).sort((a, b) => U.byRoute(a.route, b.route) || U.dayIndex(a.day) - U.dayIndex(b.day));
  return { customers, routeDays, meta: meta.exists ? meta.data() : null };
}

/** What every screen gets: the plant's customers and route days, and what this person may change. */
async function view(db, plant, person) {
  const d = await readPlant(db, plant), r = rightsOf(person);
  return { plant, plantName: plantName(plant), plants: L.plantsFor(person).filter(id => (L.PLANTS.find(p => p.id === id) || {}).status === 'ACTIVE').map(id => ({ id, name: plantName(id) })),
    customers: d.customers, routeDays: d.routeDays, imported: d.meta ? { at: d.meta.at || '', by: d.meta.by || '', fileName: d.meta.fileName || '', counts: d.meta.counts || {} } : null,
    canEdit: r.edit, canImport: r.importList };
}

function logEntry(db, batchOrTx, what, plant, ref, before, after, email, stamp) {
  const entry = { what, plant, record: ref.id, before: before === undefined ? null : before, after: after === undefined ? null : after, by: email, at: stamp };
  const logRef = db.collection(LOG).doc();
  batchOrTx.set(logRef, JSON.parse(JSON.stringify(entry)));
}

/** Saves one route day: its stops in run order (each with its load sequence and stop note), the start time and instructions. */
async function saveRouteDay(db, plant, email, input, stamp) {
  const route = U.numText(input.route, U.LIMITS.route), day = U.dayOf(input.day);
  if (!route || !day) fail('BAD_REQUEST', 'Pick a route and a day.');
  const stops = input.stops === undefined ? undefined : U.cleanStops(input.stops);
  if (input.stops !== undefined && !stops) fail('BAD_REQUEST', 'The stops did not come through. Reload and try again.');
  const ref = db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day));
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
    if (before && input.rev !== undefined && Number(input.rev) !== Number(before.rev || 0)) fail('CHANGED', 'Someone else changed route ' + route + ' ' + U.DAY_NAMES[day] + ' a moment ago. The screen now shows their change; make yours again.');
    const after = Object.assign({ plant, route, day, stops: [], startTime: '', notes: '', map: null, rev: 0 }, before || {});
    if (stops) {
      // Every stop must be a customer on the list (a new customer is added on the Customers screen first).
      const keys = stops.map(s => s.key), refs = keys.map(k => db.collection(CUSTOMERS).doc(U.customerId(plant, k)));
      const found = refs.length ? await tx.getAll(...refs) : [];
      const missing = keys.filter((k, i) => !found[i].exists);
      if (missing.length) fail('BAD_REQUEST', 'These customers are not on the customer list: ' + missing.join(', ') + '. Add them on the Customers screen first.');
      after.stops = stops.map((s, i) => { const c = found[i].data(); return { key: s.key, account: c.account || '', name: c.name || '', chain: c.chain || '', loadSeq: s.loadSeq, note: s.note }; });
    }
    if (input.startTime !== undefined) after.startTime = U.text(input.startTime, U.LIMITS.startTime);
    if (input.notes !== undefined) after.notes = String(input.notes || '').trim().slice(0, U.LIMITS.notes);
    if (input.map !== undefined) after.map = input.map === null ? null : U.packMap(input.map);
    after.rev = (before ? before.rev || 0 : 0) + 1;
    after.updatedAt = stamp; after.updatedBy = email;
    tx.set(ref, after);
    logEntry(db, tx, 'routeDay', plant, ref, before, after, email, stamp);
    return { ok: true, routeDay: unpack(after) };
  });
}

/**
 * Joe 11/2 (Route Book, Edit): one customer's place on the routes. Takes it off route `from` on every day not kept, and puts it
 * on route `route` on each day in `days` (a day the route did not run yet starts a new route day). On a day it is new to, it goes
 * after the last stop with the same or a higher load sequence. `day` (the day being edited) gets `loadSeq` and `note`; a day it is
 * added to takes that load sequence too. days empty = taken off route `from` altogether.
 */
async function placeStop(db, plant, email, input, stamp) {
  const key = U.text(input.key, 60), from = U.numText(input.from, U.LIMITS.route), route = U.numText(input.route, U.LIMITS.route) || from;
  const day = U.dayOf(input.day), dayList = (v) => [...new Set((Array.isArray(v) ? v : []).map(U.dayOf).filter(Boolean))];
  // days: the days it is on `route` afterwards. stay (Joe 11/2, a move to another route): the days it keeps on `from`.
  const days = dayList(input.days), stay = route !== from ? dayList(input.stay) : [];
  if (!key || !from || !route) fail('BAD_REQUEST', 'Pick a customer and a route.');
  const loadSeq = input.loadSeq === undefined ? undefined : U.seqOf(input.loadSeq), note = input.note === undefined ? undefined : U.text(input.note, U.LIMITS.note);
  const cref = db.collection(CUSTOMERS).doc(U.customerId(plant, key));
  const refs = {};
  U.DAYS.forEach(d => { refs[from + '|' + d] = db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, from, d)); refs[route + '|' + d] = db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, d)); });
  const keys = Object.keys(refs);
  return db.runTransaction(async tx => {
    const c = await tx.get(cref);
    if (!c.exists) fail('NOT_FOUND', 'That customer is not on the list any more. Reload the page.');
    const cust = c.data(), snaps = await tx.getAll(...keys.map(k => refs[k]));
    const docs = {};
    keys.forEach((k, i) => { docs[k] = snaps[i].exists ? snaps[i].data() : null; });
    const was = (day && docs[from + '|' + day] && (docs[from + '|' + day].stops || []).find(x => x.key === key)) || null;
    const seq = loadSeq !== undefined ? loadSeq : (was ? was.loadSeq : 0);
    const changed = {};
    keys.forEach(k => {
      const [r, d] = k.split('|'), before = docs[k], keep = r === route && days.includes(d);
      let stops = before ? (before.stops || []).slice() : [];
      const at = stops.findIndex(x => x.key === key);
      if (keep) {
        if (at < 0) {
          const stop = { key, account: cust.account || '', name: cust.name || '', chain: cust.chain || '', loadSeq: seq, note: d === day && note !== undefined ? note : '' };
          let i = stops.length;
          while (i > 0 && (Number(stops[i - 1].loadSeq) || 0) < seq) i--;
          stops.splice(i, 0, stop);
        } else if (d === day) {
          stops[at] = Object.assign({}, stops[at], loadSeq !== undefined ? { loadSeq } : {}, note !== undefined ? { note } : {});
        } else return;
      } else {
        if (r !== from || at < 0 || stay.includes(d)) return;
        stops.splice(at, 1);
      }
      const after = Object.assign({ plant, route: r, day: d, stops: [], startTime: '', notes: '', map: null, rev: 0 }, before || {});
      after.stops = stops;
      if (!before) after.map = U.packMap(U.autoMap(stops));
      after.rev = (before ? before.rev || 0 : 0) + 1;
      after.updatedAt = stamp; after.updatedBy = email;
      changed[k] = [before, after];
    });
    Object.keys(changed).forEach(k => { const [before, after] = changed[k]; tx.set(refs[k], after); logEntry(db, tx, 'routeDay', plant, refs[k], before, after, email, stamp); });
    return { ok: true, changed: Object.keys(changed).map(k => unpack(changed[k][1])), message: Object.keys(changed).length ? '' : 'Nothing to change.' };
  });
}

/** Saves a customer (or adds one: input.add with an account number, or a name for a customer with none). */
async function saveCustomer(db, plant, email, input, stamp) {
  const fields = U.cleanCustomer(input.fields || {});
  let key = U.text(input.key, 60);
  if (input.add) {
    const account = U.numText(input.account, U.LIMITS.account);
    if (!fields.name) fail('BAD_REQUEST', 'Type the customer\'s name.');
    key = U.custKey(account, fields.name);
    fields.account = account === '0' ? '' : account;
  }
  if (!key) fail('BAD_REQUEST', 'Pick a customer.');
  const ref = db.collection(CUSTOMERS).doc(U.customerId(plant, key));
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref), before = snap.exists ? snap.data() : null;
    if (input.add && before) fail('BAD_REQUEST', 'Account ' + key + ' is already on the list (' + before.name + ').');
    if (!input.add && !before) fail('NOT_FOUND', 'That customer is not on the list any more. Reload the page.');
    if (fields.name === '') fail('BAD_REQUEST', 'A customer needs a name.');
    const after = Object.assign({ plant, key, account: '', name: '', chain: '', dc: U.PLANT_DC[plant] || '', address: '', address2: '', city: '', state: '', zip: '', phone: '', contact: '', keys: '', notes: '', lat: null, lon: null, active: true },
      before || {}, fields, { updatedAt: stamp, updatedBy: email });
    tx.set(ref, after);
    logEntry(db, tx, 'customer', plant, ref, before, after, email, stamp);
    return { ok: true, customer: after };
  });
}

/**
 * The Route Menu workbook, read on the screen (Customer By Route, Address List, GPS Address; and the Route Book if it was picked
 * too). input: { stops, unrouted, addresses: {account: {...}}, gps: {nameKey: {...}}, book: {'803|TUE': {...}}, fileName }.
 *
 * Joe 11/1: "anything that is uploaded ... overrules everything if I do a new upload only." Changes made in the app stay until
 * the next upload; nothing else puts them back. At an upload, whatever the files have wins: the Route Menu decides who is on
 * which route day and each stop's load sequence; the Route Book (if picked) the run order, start time, instructions, keys and
 * truck drawing (where its numbers still match); the address tabs the addresses. What the files do not have stays as typed here
 * (phones, contacts, notes, stop notes, and the run order and load map when no Route Book was picked). A route day no longer in
 * the Route Menu is removed; a customer no longer on any line is kept but marked not active.
 */
async function importMenu(db, plant, email, input, stamp) {
  const stops = (Array.isArray(input.stops) ? input.stops : []).slice(0, U.MAX_LINES);
  const unrouted = (Array.isArray(input.unrouted) ? input.unrouted : []).slice(0, U.MAX_LINES);
  if (!stops.length) fail('BAD_REQUEST', 'No customer lines were found. Pick the Route Menu workbook with its Customer By Route tab.');
  const clean = (s) => { const x = { day: U.dayOf(s.day), route: U.numText(s.route, U.LIMITS.route), account: U.numText(s.account, U.LIMITS.account), chain: U.numText(s.chain, U.LIMITS.chain), name: U.text(s.name, U.LIMITS.name), loadSeq: U.seqOf(s.loadSeq) }; if (x.account === '0') x.account = ''; x.key = U.custKey(x.account, x.name); return x; };
  const lines = stops.map(clean).filter(x => x.day && x.route && x.name), loose = unrouted.map(clean).filter(x => x.day && x.name);
  const addresses = input.addresses || {}, gps = input.gps || {}, book = input.book || {};
  const now = await readPlant(db, plant);

  // The customers.
  const people = {};
  lines.concat(loose).forEach(x => { if (!people[x.key]) people[x.key] = x; });
  const writes = [];
  let added = 0, changed = 0, filled = 0, inactive = 0;
  const keysFrom = {};
  Object.keys(book).forEach(k => ((book[k] && book[k].stops) || []).forEach(b => { const ck = U.custKey(b.account, b.name); if (b.keys && !keysFrom[ck]) keysFrom[ck] = U.text(b.keys, U.LIMITS.keys); }));
  Object.keys(people).forEach(key => {
    const x = people[key], before = now.customers[key] || null;
    const a = (x.account && addresses[x.account]) || {}, g = gps[U.nameKey(x.name)] || {};
    const after = Object.assign({ plant, key, account: x.account, name: x.name, chain: x.chain, address: '', address2: '', city: '', state: '', zip: '', phone: '', contact: '', keys: '', notes: '', lat: null, lon: null }, before || {});
    after.name = x.name; after.chain = x.chain; after.account = x.account; after.active = true;
    if (!after.dc) after.dc = U.PLANT_DC[plant] || '';
    // What the upload has replaces what is here (counted when it changes something).
    const fill = (k, v) => { if (v !== undefined && v !== null && v !== '' && after[k] !== v) { after[k] = v; return 1; } return 0; };
    const got = U.cleanCustomer({ address: a.address || g.address, address2: a.address2, city: a.city || g.city, state: a.state || g.state, zip: a.zip, keys: keysFrom[key], lat: g.lat, lon: g.lon });
    // Joe 11/2: a PO box, mailbox, RR box or "c/o" is not a ship-to address. The upload never puts one in place of a street address,
    // and an address that was checked (looked up by the store's name, addressChecked) stays through the upload: Joe chose that on
    // 11/2 ("Keep them") so the real ship-to addresses are not undone by the next Route Menu.
    if (U.notStreet(got.address2)) delete got.address2;
    if (after.addressChecked || (U.notStreet(got.address) && after.address && !U.notStreet(after.address))) U.ADDRESS_FIELDS.forEach(k => { delete got[k]; });
    let n = 0;
    Object.keys(got).forEach(k => { n += fill(k, got[k]); });
    if (!before) added++; else if (before.name !== after.name || before.chain !== after.chain || before.active === false) changed++;
    if (n) filled++;
    if (!before || JSON.stringify(Object.assign({}, before, { updatedAt: 0, updatedBy: 0 })) !== JSON.stringify(Object.assign({}, after, { updatedAt: 0, updatedBy: 0 }))) {
      after.updatedAt = stamp; after.updatedBy = email;
      writes.push([db.collection(CUSTOMERS).doc(U.customerId(plant, key)), after]);
    }
  });
  Object.keys(now.customers).forEach(key => {
    // A customer from the company's full list (Joe 11/2) is a customer with no route, not one that left the Route Menu.
    if (people[key] || now.customers[key].active === false || now.customers[key].onCompanyList) return;
    inactive++;
    writes.push([db.collection(CUSTOMERS).doc(U.customerId(plant, key)), Object.assign({}, now.customers[key], { active: false, updatedAt: stamp, updatedBy: email })]);
  });

  // The route days.
  const groups = {};
  lines.forEach(x => { const k = x.route + '|' + x.day; (groups[k] = groups[k] || []).push(x); });
  const had = {};
  now.routeDays.forEach(rd => { had[rd.route + '|' + rd.day] = rd; });
  let newDays = 0, removedDays = 0, bookUsed = 0;
  Object.keys(groups).forEach(k => {
    const [route, day] = k.split('|'), list = groups[k], before = had[k] || null, b = book[k] || null;
    const ordered = U.runOrder(list, before ? (before.stops || []).map(s => s.key) : null, b);
    const notes = (b && b.instructions || []).join('\n');
    const after = Object.assign({ plant, route, day, stops: [], startTime: '', notes: '', map: null, rev: 0 }, before || {});
    after.stops = ordered.map(x => { const old = before && (before.stops || []).find(s => s.key === x.key); return { key: x.key, account: x.account, name: x.name, chain: x.chain, loadSeq: x.loadSeq, note: old ? old.note || '' : '' }; });
    if (b && b.startTime) after.startTime = U.text(b.startTime, U.LIMITS.startTime);
    if (notes) after.notes = notes.slice(0, U.LIMITS.notes);
    // The Route Book's drawing when it fits; else the one here while every number on it is still a load sequence; else a new one.
    const kept = after.map && U.mapFits(after.map, after.stops) ? U.cleanMap(after.map) : null;
    after.map = U.packMap(U.bookMap(b, after.stops) || kept || U.autoMap(after.stops));
    if (!before) newDays++;
    if (!before && b) bookUsed++;
    after.rev = (before ? before.rev || 0 : 0) + 1;
    after.updatedAt = stamp; after.updatedBy = email;
    writes.push([db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day)), after]);
  });
  const deletes = now.routeDays.filter(rd => !groups[rd.route + '|' + rd.day]).map(rd => db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, rd.route, rd.day)));
  removedDays = deletes.length;

  const counts = { customers: Object.keys(people).length, lines: lines.length, routeDays: Object.keys(groups).length, routes: new Set(lines.map(x => x.route)).size,
    unrouted: loose.length, added, changed, filled, inactive, newDays, removedDays, bookUsed, noLoadSeq: lines.filter(x => !x.loadSeq).length };
  // Firestore takes at most 500 writes at once.
  const all = writes.map(w => ['set', w[0], w[1]]).concat(deletes.map(r => ['delete', r]));
  for (let i = 0; i < all.length; i += 400) {
    const batch = db.batch();
    all.slice(i, i + 400).forEach(w => { if (w[0] === 'set') batch.set(w[1], w[2]); else batch.delete(w[1]); });
    await batch.commit();
  }
  const meta = { plant, at: stamp, by: email, fileName: U.text(input.fileName, 120), counts, unrouted: loose.slice(0, 200) };
  await db.collection('private').doc('udcl_' + plant).set(meta);
  await db.collection(LOG).add({ what: 'import', plant, record: 'udcl_' + plant, before: null, after: { fileName: meta.fileName, counts }, by: email, at: stamp });
  return { ok: true, counts, message: 'Imported ' + counts.customers + ' customers on ' + counts.routes + ' routes (' + counts.routeDays + ' route days) for ' + plantName(plant) + '.' };
}

/**
 * The customer list already in Operations (the Sales app's, uploaded on Administration > Sales App): brought over as it is, for a
 * plant with no Route Menu import yet. It has no load sequence; the Route Menu import adds it later.
 */
async function copySales(db, plant, email, input, stamp) {
  const s = await db.collection('salesCustomers').doc(plant).get();
  const rows = s.exists && Array.isArray(s.data().rows) ? s.data().rows : [];
  if (!rows.length) fail('NOT_FOUND', 'There is no Sales app customer list for ' + plantName(plant) + ' to bring over.');
  return importMenu(db, plant, email, { stops: rows.filter(r => r.route), unrouted: rows.filter(r => !r.route), fileName: 'Sales app list (' + (s.data().fileName || 'uploaded') + ')' }, stamp);
}

/** For the drivers' phone: one route day's stops in run order, with each customer's address, keys and notes. */
async function routeBook(db, plant, route, day) {
  route = U.numText(String(route || '').replace(/_\d+$/, ''), U.LIMITS.route); day = U.dayOf(day);
  if (!route || !day) return { found: false };
  let s = await db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day)).get();
  // Dispatch may name a route with words around its number ("803 PITTSBURGH"): the number alone, then.
  const num = (/\d{3,}/.exec(route) || [])[0];
  if (!s.exists && num && num !== route) { route = num; s = await db.collection(ROUTE_DAYS).doc(U.routeDayId(plant, route, day)).get(); }
  if (!s.exists) return { found: false, route, day };
  const rd = s.data(), keys = (rd.stops || []).map(x => x.key);
  const refs = keys.map(k => db.collection(CUSTOMERS).doc(U.customerId(plant, k)));
  const cs = refs.length ? await db.getAll(...refs) : [];
  const stops = (rd.stops || []).map((x, i) => { const c = cs[i] && cs[i].exists ? cs[i].data() : {}; return { stop: i + 1, name: c.name || x.name, account: c.account || x.account || '', loadSeq: x.loadSeq || 0, note: x.note || '',
    address: U.addressLine(c), phone: c.phone || '', keys: c.keys || '', notes: c.notes || '', lat: c.lat || null, lon: c.lon || null }; });
  return { found: true, route, day, dayName: U.DAY_NAMES[day], startTime: rd.startTime || '', notes: rd.notes || '', map: rd.map ? U.cleanMap(rd.map) : null, stops, updatedAt: rd.updatedAt || '' };
}

/**
 * Checked ship-to addresses (Joe 11/2: "find the true address ... PO box or mailbox is not a true address"), looked up by the
 * store's name and town. An Administrator uploads the sheet with Import Addresses on Customers (importAddresses). rows:
 * [{ key, address, address2, city, state, zip, confidence, source }]. Only customers already on the list are changed; each is marked
 * addressChecked so the next Route Menu upload keeps it (importMenu). Returns the counts.
 */
async function loadAddresses(db, plant, rows, by, stamp) {
  const now = await readPlant(db, plant);
  let changed = 0, same = 0, missing = 0, refused = 0;
  const writes = [];
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const key = U.text(r && r.key, 60), before = now.customers[key];
    if (!before) { missing++; return; }
    const fields = U.cleanCustomer({ address: r.address, address2: r.address2 || '', city: r.city, state: r.state, zip: r.zip });
    if (!fields.address || U.notStreet(fields.address) || U.notStreet(fields.address2)) { refused++; return; }
    const after = Object.assign({}, before, fields, { addressChecked: true, addressSource: U.text(r.source, 200), addressConfidence: U.text(r.confidence, 20) });
    if (fields.address !== before.address || fields.city !== before.city) { after.lat = null; after.lon = null; }
    if (JSON.stringify(Object.assign({}, before, { updatedAt: 0, updatedBy: 0 })) === JSON.stringify(Object.assign({}, after, { updatedAt: 0, updatedBy: 0 }))) { same++; return; }
    after.updatedAt = stamp; after.updatedBy = by;
    changed++;
    writes.push([db.collection(CUSTOMERS).doc(U.customerId(plant, key)), before, after]);
  });
  for (let i = 0; i < writes.length; i += 200) {
    const batch = db.batch();
    writes.slice(i, i + 200).forEach(([ref, before, after]) => {
      batch.set(ref, after);
      logEntry(db, batch, 'address', plant, ref, before, after, by, stamp);
    });
    await batch.commit();
  }
  return { changed, same, missing, refused };
}

async function importAddresses(db, plant, email, input, stamp) {
  const rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, U.MAX_LINES);
  if (!rows.length) fail('BAD_REQUEST', 'No addresses were found. The sheet needs Account, Street and City headings.');
  const c = await loadAddresses(db, plant, rows, email, stamp);
  return { ok: true, counts: c, message: rows.length + ' addresses read: ' + c.changed + ' changed, ' + c.same + ' already right' + (c.missing ? ', ' + c.missing + ' not on the list' : '') + (c.refused ? ', ' + c.refused + ' left out (a PO box, mailbox or c/o is not a ship-to address)' : '') + '. They stay through the next Route Menu upload.' };
}

/**
 * Joe 11/2: "The full list can be uploaded if the customer is not showing on there. It needs to be added." The company's full
 * customer list (every distribution center; fullListRows). Only this plant's distribution center is read (Joe picked: Uniontown now,
 * each other DC once its plant is set up). A customer not on the list is added with no route. One already here keeps its routes,
 * name and notes; its chain and address are filled in from the list, except a checked address (addressChecked) and never a PO box,
 * mailbox or c/o in place of a street. Match on the account, inside this plant's DC (account numbers repeat across DCs).
 */
async function importFullList(db, plant, email, input, stamp) {
  const all = (Array.isArray(input.rows) ? input.rows : []).slice(0, 20000);
  if (!all.length) fail('BAD_REQUEST', 'No customers were found. The full list needs DC, ACCOUNT and NAME headings.');
  const dc = U.PLANT_DC[plant] || '';
  if (!dc) fail('BAD_REQUEST', 'This plant has no distribution center number yet, so the full list cannot be read for it.');
  const mine = all.filter(r => U.numText(r && r.dc, 6).replace(/^0+(?=\d)/, '') === dc);
  const now = await readPlant(db, plant);
  let added = 0, filled = 0, same = 0;
  const writes = [];
  mine.forEach(r => {
    const account = U.numText(r.account, U.LIMITS.account), name = U.text(r.name, U.LIMITS.name);
    if (!account || !name) return;
    const key = U.custKey(account, name), before = now.customers[key] || null;
    const after = Object.assign({ plant, key, account: account === '0' ? '' : account, name, chain: '', dc, address: '', address2: '', city: '', state: '', zip: '', phone: '', contact: '', keys: '', notes: '', lat: null, lon: null, active: true }, before || {});
    after.onCompanyList = true;
    if (!after.dc) after.dc = dc;
    const got = U.cleanCustomer({ chain: r.chain, address: r.address, address2: r.address2, city: r.city, state: r.state, zip: r.zip });
    if (U.notStreet(got.address2)) delete got.address2;
    if (after.addressChecked || !got.address || (U.notStreet(got.address) && after.address && !U.notStreet(after.address))) ['address', 'address2', 'city', 'state', 'zip'].forEach(k => { delete got[k]; });
    else if (!got.address2) got.address2 = '';
    let n = 0;
    Object.keys(got).forEach(k => { const v = got[k]; if (v !== undefined && v !== null && (v !== '' || k === 'address2') && after[k] !== v) { after[k] = v; n++; } });
    if (before && (after.address !== before.address || after.city !== before.city)) { after.lat = null; after.lon = null; }
    if (before && JSON.stringify(Object.assign({}, before, { updatedAt: 0, updatedBy: 0 })) === JSON.stringify(Object.assign({}, after, { updatedAt: 0, updatedBy: 0 }))) { same++; return; }
    if (!before) added++; else if (n) filled++; else same++;
    after.updatedAt = stamp; after.updatedBy = email;
    writes.push([db.collection(CUSTOMERS).doc(U.customerId(plant, key)), before, after]);
  });
  for (let i = 0; i < writes.length; i += 200) {
    const batch = db.batch();
    writes.slice(i, i + 200).forEach(([ref, before, after]) => { batch.set(ref, after); logEntry(db, batch, 'customer', plant, ref, before, after, email, stamp); });
    await batch.commit();
  }
  const other = all.length - mine.length;
  const counts = { read: mine.length, added, filled, same, otherDc: other };
  return { ok: true, counts, message: mine.length + ' customers for ' + (U.DCS.find(d => d.code === dc) || { name: 'DC ' + dc }).name + ': ' + added + ' added (no route yet), ' + filled + ' had their chain or address filled in, ' + same + ' already right.' + (other ? ' ' + other + ' customers of other distribution centers were left for their own plants.' : '') };
}

const OPS = { saveRouteDay, placeStop, saveCustomer, importMenu, copySales, importAddresses, importFullList };
const NEEDS = { saveRouteDay: 'edit', placeStop: 'edit', saveCustomer: 'edit', importMenu: 'importList', copySales: 'importList', importAddresses: 'importList', importFullList: 'importList' };

/** The one call. db = the company's database; who = the signed-in person ({ email }); plant = the plant the call is for (checked). */
async function udclCall(db, who, plant, input, deps) {
  input = input || {};
  const op = String(input.op || 'view');
  const email = String(who && who.email || '').toLowerCase();
  const person = await personOf(db, email);
  const r = rightsOf(person);
  if (!r.view) fail('NOT_ALLOWED', 'You are not on the Users list. Ask an administrator to add you.');
  // No plant named (the first time on this browser): the person's first plant that is running.
  if (!plant) plant = L.plantsFor(person).find(id => (L.PLANTS.find(p => p.id === id) || {}).status === 'ACTIVE') || L.HOME_PLANT;
  if (L.plantsFor(person).indexOf(plant) < 0) fail('NOT_ALLOWED', 'You are not set up for ' + plantName(plant) + '.');
  if (op === 'view') return view(db, plant, person);
  if (op === 'routeBook') return routeBook(db, plant, input.route, input.day);
  const fn = OPS[op];
  if (!fn) fail('BAD_REQUEST', 'Unknown Customer List step: ' + op);
  if (!r[NEEDS[op]]) fail('NOT_ALLOWED', NEEDS[op] === 'importList' ? 'Only an administrator can import the customer list.' : 'Only an Administrator or Manager can change the customer list and route sequence.');
  const stamp = ((deps && deps.now) ? deps.now() : new Date()).toISOString();
  const out = await fn(db, plant, email, input, stamp);
  return Object.assign(out, input.thenView ? await view(db, plant, person) : {});
}

/** The Sales app's lines from the Customer List: { rows: [{ day, route, account, chain, name }], savedAt }, or null when it has none. */
async function salesRows(db, plant) {
  // A plant whose list was never imported here has none (the Sales app keeps its own upload then).
  if (!(await db.collection('private').doc('udcl_' + plant).get()).exists) return null;
  const d = await readPlant(db, plant);
  if (!d.routeDays.length) return null;
  const rows = [];
  d.routeDays.forEach(rd => (rd.stops || []).forEach(s => { const c = d.customers[s.key] || {}; if (c.active === false) return; rows.push({ day: rd.day, route: rd.route, account: c.account || s.account || '', chain: c.chain || s.chain || '', name: c.name || s.name || '' }); }));
  ((d.meta && d.meta.unrouted) || []).forEach(x => rows.push({ day: x.day, route: '', account: x.account || '', chain: x.chain || '', name: x.name || '' }));
  const at = d.routeDays.map(r => r.updatedAt || '').concat(Object.values(d.customers).map(c => c.updatedAt || '')).sort().pop() || '';
  return { rows, savedAt: at };
}

module.exports = { udclCall, salesRows, routeBook, importMenu, loadAddresses, saveRouteDay, placeStop, saveCustomer, copySales, view, readPlant, rightsOf, UdclError, CUSTOMERS, ROUTE_DAYS, LOG };
