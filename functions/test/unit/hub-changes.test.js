'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/hubchanges');
const { fakeDb } = require('./fake-db.cjs');

// Joe 11-12-26: a map point approved in the Hub is saved on the customer, with the address when one comes with it.
// Made-up customers only.
const PLANT = 'fac_uniontown';
const STAMP = '2026-11-13T12:00:00.000Z';
const cust = (key, o) => Object.assign({ plant: PLANT, key, account: key, name: 'ACME MARKET', chain: '0', address: '1 OLD RD', address2: '', city: 'SOMEWHERE', state: 'PA', zip: '15000', phone: '', lat: null, lon: null, active: true }, o || {});
const change = (input, o) => Object.assign({ plant: PLANT, from: 'mapmaker', kind: 'mapPoint', status: 'approved', approvedBy: 'boss@example.com', approvedAt: STAMP,
  input: Object.assign({ op: 'setMapPoint', account: '5001', chain: '0', lat: 39.9, lon: -79.7, source: 'pin' }, input) }, o || {});
const seed = (changes, more) => fakeDb(Object.assign({
  ['udclCustomers/' + PLANT + '__5001']: cust('5001'),
  ['udclCustomers/' + PLANT + '__1522']: cust('1522', { name: 'KUHNS MADE-UP', chain: '415' }),
  ['udclCustomers/' + PLANT + '__1522-C990']: cust('1522-C990', { account: '1522', name: 'BIG BOX #1522', chain: '990' })
}, ...Object.entries(changes).map(([id, c]) => ({ ['hubCustomerChanges/' + id]: c })), more || {}));
const doc = (db, path) => db.docs.get(path);
const logs = (db) => [...db.docs.keys()].filter(k => k.startsWith('udclLog/')).map(k => db.docs.get(k));

test('an approved pin saves the map point and nothing else, logs it and marks the change applied', async () => {
  const db = seed({ c1: change({}) });
  const out = await H.applyAndPublish(db, 'c1', STAMP);
  assert.equal(out.done, 'applied');
  const c = doc(db, 'udclCustomers/' + PLANT + '__5001');
  assert.equal(c.lat, 39.9); assert.equal(c.lon, -79.7);
  assert.equal(c.address, '1 OLD RD', 'the address stays when none came');
  assert.equal(c.gpsFrom, 'MapMaker pin, approved in the Hub');
  assert.equal(c.updatedBy, 'boss@example.com');
  const ch = doc(db, 'hubCustomerChanges/c1');
  assert.equal(ch.status, 'applied'); assert.equal(ch.appliedAt, STAMP); assert.equal(ch.input.op, 'setMapPoint', 'the rest of the change stays');
  assert.equal(logs(db).length, 1); assert.equal(logs(db)[0].what, 'mapPoint'); assert.equal(logs(db)[0].change, 'c1');
  assert.ok(doc(db, 'udclRouteMaster/' + PLANT), 'the Route Master record is brought up to date for the Hub');
});

test('a change found by name saves the address too, checked so the next upload keeps it', async () => {
  const db = seed({ c2: change({ source: 'search', address: 'Acme Market, 1234 Made-Up Rd, Uniontown, PA 15401-1234, United States' }) });
  assert.equal((await H.applyChange(db, 'c2', STAMP)).done, 'applied');
  const c = doc(db, 'udclCustomers/' + PLANT + '__5001');
  assert.deepEqual([c.address, c.address2, c.city, c.state, c.zip], ['1234 Made-Up Rd', '', 'Uniontown', 'PA', '15401'], 'the place name and the country are dropped');
  assert.equal(c.addressChecked, true);
  assert.equal(c.lat, 39.9, 'the new point is kept, not cleared by the new address');
  assert.match(c.gpsFrom, /found by name/);
});

test('the address can come in parts', () => {
  assert.deepEqual(H.addressOf({ street: '9 Pretend Ave', city: 'Charleston', stateCode: 'WV', postalCode: '25301' }), { address: '9 Pretend Ave', address2: '', city: 'Charleston', state: 'WV', zip: '25301' });
  assert.deepEqual(H.addressOf('77 Sample St, Martins Ferry, OH 43935'), { address: '77 Sample St', address2: '', city: 'Martins Ferry', state: 'OH', zip: '43935' });
  assert.equal(H.addressOf('Somewhere in Ohio'), null);
});

test('an address that cannot be read, or a PO box, leaves the address and saves the point', async () => {
  const db = seed({ a: change({ address: 'near the river' }), b: change({ address: 'PO Box 12, Uniontown, PA 15401' }) });
  await H.applyChange(db, 'a', STAMP);
  assert.match(doc(db, 'hubCustomerChanges/a').addressLeftOut, /could not be read/);
  await H.applyChange(db, 'b', STAMP);
  assert.match(doc(db, 'hubCustomerChanges/b').addressLeftOut, /PO box/);
  const c = doc(db, 'udclCustomers/' + PLANT + '__5001');
  assert.equal(c.address, '1 OLD RD'); assert.equal(c.lat, 39.9);
});

test('two stores with one account number: the chain picks the store; the Hub key wins', async () => {
  const db = seed({ k: change({ account: '1522', chain: '990', lat: 40.1, lon: -80.1 }), j: change({ account: '1522', chain: '415', key: '1522', lat: 40.2, lon: -80.2 }) });
  await H.applyChange(db, 'k', STAMP);
  await H.applyChange(db, 'j', STAMP);
  assert.equal(doc(db, 'udclCustomers/' + PLANT + '__1522-C990').lat, 40.1);
  assert.equal(doc(db, 'udclCustomers/' + PLANT + '__1522').lat, 40.2);
});

test('turned away: no such customer, a point that is not a place, the wrong step', async () => {
  const db = seed({ x: change({ account: '9999' }), y: change({ lat: 0, lon: 0 }), z: change({ op: 'saveCustomer' }) });
  for (const id of ['x', 'y', 'z']) assert.equal((await H.applyChange(db, id, STAMP)).done, 'rejected');
  assert.match(doc(db, 'hubCustomerChanges/x').why, /No customer with account 9999/);
  assert.match(doc(db, 'hubCustomerChanges/y').why, /not a real place/);
  assert.equal(doc(db, 'udclCustomers/' + PLANT + '__5001').lat, null, 'nothing saved');
});

test('only approved map point changes: sent, turned down, applied and other kinds are left alone', async () => {
  const db = seed({ s: change({}, { status: 'sent' }), t: change({}, { status: 'turnedDown' }), r: change({}, { kind: 'routeDay' }), w: change({}) });
  for (const id of ['s', 't', 'r']) assert.equal((await H.applyChange(db, id, STAMP)).done, 'skipped');
  assert.equal(doc(db, 'hubCustomerChanges/r').status, 'approved', 'a route day change waits for its own step');
  assert.deepEqual(await H.waitingIds(db), ['w']);
  assert.equal((await H.applyChange(db, 'w', STAMP)).done, 'applied');
  assert.equal((await H.applyChange(db, 'w', STAMP)).done, 'skipped', 'saved once only');
  assert.deepEqual(await H.waitingIds(db), []);
});
