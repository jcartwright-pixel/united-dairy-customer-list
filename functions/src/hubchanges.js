/*
 * Changes approved in the United Dairy Hub (Joe 11-9-26: "The hub is the only thing allowed to save to the customer list").
 * Another app sends its change to the Hub as hubCustomerChanges/<id> (status 'sent'); an administrator approves it on the Hub's
 * Customer Changes screen (status 'approved', approvedBy, approvedAt); this app's server, the only code that writes the
 * customer list, saves it and sets the status: 'applied' (appliedBy, appliedAt) or 'rejected' (why, rejectedAt).
 *
 * Built so far: kind 'mapPoint' (Joe 11-12-26, the MapMaker: a missing pin, a dragged pin, an address lookup, a store found by
 * name, the EasyMapMaker import). input { op: 'setMapPoint', account, chain, key?, lat, lon, source: 'pin' | 'lookup' |
 * 'search' | 'import', address? }. It saves that customer's map point and nothing else, and, when the change carries an
 * address (Joe 11-12-26: "find the correct address going by the name and location"), that address too. Other kinds are left
 * as they are (still 'approved') until their step is built here.
 */
'use strict';

const U = require('./udcl-rules');

const CHANGES = 'hubCustomerChanges';
const CUSTOMERS = 'udclCustomers';
const LOG = 'udclLog';
const BUILT = ['mapPoint'];
const SOURCE_WORDS = { pin: 'MapMaker pin', lookup: 'MapMaker address lookup', search: 'MapMaker, found by name', import: 'EasyMapMaker import' };

/** A map point that is a real place: both numbers, inside the world, not 0, 0. */
function pointOf(lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (lat === null || lat === '' || lon === null || lon === '' || !isFinite(la) || !isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180 || (!la && !lo)) return null;
  return { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
}

const COUNTRY = /^(UNITED STATES( OF AMERICA)?|USA?|US)$/i;
const STATE_ZIP = /^([A-Za-z]{2})\s+(\d{5})(-\d{4})?$/;
/**
 * The address that came with the change: { address, city, state, zip }, or null when it cannot be read. Either the parts
 * ({ street | address, city, state | stateCode, zip | postalCode }) or one line as the map service writes it:
 * "1234 Made-Up Rd, Uniontown, PA 15401, United States" (a place name in front, "Made-Up Market, 1234 ...", is dropped).
 */
function addressOf(a) {
  if (!a) return null;
  let out;
  if (typeof a === 'object') {
    out = { address: a.street || a.address || [a.houseNumber, a.street].filter(Boolean).join(' '), city: a.city, state: a.state || a.stateCode, zip: a.zip || a.postalCode };
  } else {
    const parts = String(a).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length && COUNTRY.test(parts[parts.length - 1])) parts.pop();
    if (parts.length < 3) return null;
    const m = STATE_ZIP.exec(parts[parts.length - 1]);
    if (!m) return null;
    const city = parts[parts.length - 2], before = parts.slice(0, -2);
    const at = before.findIndex(s => /^\d/.test(s));
    out = { address: (at > 0 ? before.slice(at) : before).join(', '), city, state: m[1], zip: m[2] };
  }
  const c = U.cleanCustomer({ address: out.address, city: out.city, state: out.state, zip: out.zip });
  if (!c.address || !c.city || !c.state) return null;
  return { address: c.address, address2: '', city: c.city, state: c.state, zip: c.zip || '' };
}

/** The customer the change is for: by the Hub's key when it has one, else by account number (and chain when two share it). */
async function findCustomer(db, plant, input) {
  const key = U.text(input.key, 60);
  if (key) {
    const s = await db.collection(CUSTOMERS).doc(U.customerId(plant, key)).get();
    if (s.exists) return s.data();
  }
  const account = U.numText(input.account, U.LIMITS.account), chain = U.numText(input.chain, U.LIMITS.chain);
  if (!account || account === '0') return null;
  const list = (await db.collection(CUSTOMERS).where('plant', '==', plant).get()).docs.map(d => d.data()).filter(c => String(c.account || '') === account);
  if (list.length < 2) return list[0] || null;
  const same = list.filter(c => String(c.chain || '0') === String(chain || '0'));
  return same.length === 1 ? same[0] : null;
}

/** What applying a mapPoint change saves: { ref, before, after, addressLeftOut } or { why } when it cannot be saved. */
async function mapPointWrite(db, change, stamp) {
  const input = change.input || {}, plant = String(change.plant || input.plant || '');
  if (String(input.op || '') !== 'setMapPoint') return { why: 'The change is not a map point (setMapPoint).' };
  if (!plant) return { why: 'The change has no plant.' };
  const point = pointOf(input.lat, input.lon);
  if (!point) return { why: 'The map point is not a real place.' };
  const before = await findCustomer(db, plant, input);
  if (!before) return { why: 'No customer with account ' + (U.numText(input.account, U.LIMITS.account) || '(none)') + (input.chain ? ', chain ' + U.numText(input.chain, U.LIMITS.chain) : '') + ' on the Customer List for this plant.' };
  const source = String(input.source || change.source || 'pin'), approved = String(change.approvedBy || 'the Hub');
  const after = Object.assign({}, before, point, { gpsFrom: (SOURCE_WORDS[source] || 'MapMaker') + ', approved in the Hub', updatedAt: stamp, updatedBy: approved });
  let addressLeftOut = '';
  if (input.address) {
    const a = addressOf(input.address);
    if (!a) addressLeftOut = 'The address could not be read, so only the map point was saved.';
    else if (U.notStreet(a.address)) addressLeftOut = 'The address is a PO box, mailbox or c/o, not where the truck goes, so only the map point was saved.';
    else {
      // A checked address stays through the next upload (importMenu and the master file keep addressChecked ones).
      Object.assign(after, a, { addressChecked: true, addressSource: (SOURCE_WORDS[source] || 'MapMaker') + ', approved in the Hub by ' + approved, addressCheck: 'Found in MapMaker, approved in the Hub' });
    }
  }
  return { ref: db.collection(CUSTOMERS).doc(U.customerId(plant, before.key)), before, after, addressLeftOut, plant };
}

/**
 * Applies one approved change, once: the change is read again inside the save, so two runs never both save it. Answers
 * { done: 'applied' | 'rejected' | 'skipped', plant }.
 */
async function applyChange(db, id, stamp) {
  const ref = db.collection(CHANGES).doc(id);
  const first = await ref.get();
  if (!first.exists) return { done: 'skipped' };
  const c = first.data();
  if (c.status !== 'approved' || BUILT.indexOf(c.kind) < 0) return { done: 'skipped' };
  const w = await mapPointWrite(db, c, stamp);
  return db.runTransaction(async (tx) => {
    const now = await tx.get(ref);
    if (!now.exists || now.data().status !== 'approved') return { done: 'skipped' };
    if (w.why) {
      tx.set(ref, { status: 'rejected', why: w.why, rejectedAt: stamp, rejectedBy: 'customer-list' }, { merge: true });
      return { done: 'rejected', plant: c.plant };
    }
    const cur = await tx.get(w.ref);
    if (!cur.exists) {
      tx.set(ref, { status: 'rejected', why: 'The customer is no longer on the Customer List.', rejectedAt: stamp, rejectedBy: 'customer-list' }, { merge: true });
      return { done: 'rejected', plant: c.plant };
    }
    tx.set(w.ref, w.after);
    const entry = { what: 'mapPoint', plant: w.plant, record: w.ref.id, change: id, before: w.before, after: w.after, by: w.after.updatedBy, at: stamp };
    tx.set(db.collection(LOG).doc(), JSON.parse(JSON.stringify(entry)));
    tx.set(ref, Object.assign({ status: 'applied', appliedAt: stamp, appliedBy: 'customer-list', record: w.ref.id }, w.addressLeftOut ? { addressLeftOut: w.addressLeftOut } : {}), { merge: true });
    return { done: 'applied', plant: w.plant };
  });
}

/** Every approved change of a kind built here that is still waiting (the hourly sweep, in case a trigger was missed). */
async function waitingIds(db) {
  const snap = await db.collection(CHANGES).where('status', '==', 'approved').get();
  return snap.docs.filter(d => BUILT.indexOf((d.data() || {}).kind) >= 0).map(d => d.id);
}

/** Applies a change and, when it saved, brings the plant's Route Master record up to date (so the Hub rebuilds its copy). */
async function applyAndPublish(db, id, stamp) {
  const out = await applyChange(db, id, stamp);
  if (out.done === 'applied' && out.plant) {
    const C = require('./udcl');
    await C.publishRouteMaster(db, out.plant, await C.readPlant(db, out.plant), stamp);
  }
  return out;
}

module.exports = { applyAndPublish, applyChange, waitingIds, mapPointWrite, addressOf, pointOf, CHANGES, BUILT };
