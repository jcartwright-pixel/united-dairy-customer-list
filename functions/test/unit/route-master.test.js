'use strict';
// Joe 11-9-26: the bridge to Route Cost Analysis. The Customer List writes udclRouteMaster/<plant>; Route Cost reads it.
// Made-up customers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');
const { fakeDb } = require('./fake-db.cjs');

const PLANT = 'fac_uniontown';
const people = { 'users/boss@example.com': { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'] },
  'users/mgr@example.com': { status: 'ACTIVE', roles: ['MANAGER'], facilities: [PLANT] } };
const boss = { email: 'boss@example.com' }, mgr = { email: 'mgr@example.com' };
const at = (t) => ({ now: () => new Date(t) });
const MENU = [
  ['DAY', 'ROUTE', 'Chain', 'Account', 'Name', null, null],
  ['TUE', 900, 0, 5001, 'ACME MARKET', 3, 3],
  ['TUE', 900, 415, 5002, 'BEST FOODS #2', 1, 1],
  ['TUE', 900, 0, 5003, 'CORNER STORE', 7, 7],
  ['FRI', 900, 0, 5001, 'ACME MARKET', 2, 2],
  ['WED', 901, 0, 5004, 'DAIRY DELITE', null, null]
];
const record = (db) => { const r = db.docs.get(S.ROUTE_MASTER + '/' + PLANT); return r && JSON.parse(JSON.stringify(r)); };
async function imported() {
  const db = fakeDb(people);
  const m = U.menuStops(MENU);
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: {}, gps: {}, book: {}, fileName: 'menu.xlsb' }, at('2026-11-09T12:00:00Z'));
  return db;
}

test('an import writes the Route Master record Route Cost reads: every stop in run order, days 0 = Sunday', async () => {
  const db = await imported();
  const rm = record(db);
  assert.equal(rm.plant, PLANT);
  assert.equal(rm.counts.stops, 5); assert.equal(rm.counts.routes, 2); assert.equal(rm.counts.routeDays, 3);
  const tue = rm.rows.filter(r => r.route === '900' && r.day === 2);
  assert.deepEqual(tue.map(r => r.stop), [1, 2, 3]);
  const best = rm.rows.find(r => r.account === '5002');
  assert.equal(best.chain, '415'); assert.equal(best.customer, 'BEST FOODS #2'); assert.equal(best.dayName, 'TUE');
  assert.ok(rm.rows.every(r => typeof r.load === 'number'));
  assert.equal(rm.rows.find(r => r.account === '5001' && r.day === 5).load, 2, 'Friday keeps its own load sequence');
  assert.ok(rm.sourceAt && rm.builtAt);
});

test('Joe 11/2: an inactive customer is not in the Route Master record, and comes back only when put on a route again', async () => {
  const db = await imported();
  await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['5001'], inactive: true }, at('2026-11-09T13:00:00Z'));
  let rm = record(db);
  assert.ok(!rm.rows.some(r => r.account === '5001'));
  assert.deepEqual(rm.rows.filter(r => r.route === '900' && r.day === 2).map(r => r.stop), [1, 2], 'the stops are numbered again');
  await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['5001'], inactive: false }, at('2026-11-09T14:00:00Z'));
  rm = record(db);
  assert.ok(!rm.rows.some(r => r.account === '5001'), 'active again, but on no route until someone adds it');
});

test('a customer marked inactive some other way is still left out of the record', () => {
  const d = { customers: { a: { key: 'a', account: '1', name: 'A' }, b: { key: 'b', account: '2', name: 'B', inactive: true }, c: { key: 'c', account: '3', name: 'C', active: false } },
    routeDays: [{ route: '803', day: 'MON', stops: [{ key: 'a', loadSeq: 1 }, { key: 'b' }, { key: 'c' }, { key: 'gone' }] }], meta: {} };
  const rm = S.routeMasterOf(PLANT, d);
  assert.deepEqual(rm.rows.map(r => r.account), ['1']);
  assert.equal(rm.counts.inactiveLeftOut, 3);
});

test('a route day changed outside this app (Pallet Builder) reaches the record the next time the Customers screen opens', async () => {
  const db = await imported();
  const id = U.routeDayId(PLANT, '900', 'TUE'), rd = JSON.parse(JSON.stringify(db.docs.get('udclRouteDays/' + id)));
  rd.stops.reverse(); rd.updatedAt = '2026-11-09T15:00:00.000Z';
  db.docs.set('udclRouteDays/' + id, rd);
  assert.notEqual(record(db).sourceAt, rd.updatedAt);
  await S.udclCall(db, mgr, PLANT, { op: 'view' });
  const rm = record(db);
  assert.equal(rm.sourceAt, rd.updatedAt);
  assert.equal(rm.rows.find(r => r.route === '900' && r.day === 2 && r.stop === 1).account, rd.stops[0].account);
  const built = rm.builtAt;
  await S.udclCall(db, mgr, PLANT, { op: 'view' });
  assert.equal(record(db).builtAt, built, 'not written again when nothing changed');
});

test('a route sequence saved on Route Book updates the record', async () => {
  const db = await imported();
  const v = await S.udclCall(db, mgr, PLANT, { op: 'view' });
  const rd = v.routeDays.find(r => r.route === '900' && r.day === 'TUE');
  const stops = rd.stops.slice().reverse().map(s => ({ key: s.key, loadSeq: s.loadSeq, note: '' }));
  await S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', stops, rev: rd.rev }, at('2026-11-09T16:00:00Z'));
  assert.equal(record(db).rows.find(r => r.route === '900' && r.day === 2 && r.stop === 1).account, stops[0].key);
});

test('speed: the full 5,118-customer list builds its Route Master record quickly', () => {
  const customers = {}, routeDays = [], days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  for (let i = 0; i < 5118; i++) customers['k' + i] = { key: 'k' + i, account: String(10000 + i), chain: '0', name: 'MADE UP STORE ' + i, inactive: i % 9 === 0, updatedAt: '2026-11-09T12:00:00.000Z' };
  for (let r = 0; r < 120; r++) days.forEach(day => routeDays.push({ route: String(800 + r), day, updatedAt: '2026-11-09T12:00:00.000Z',
    stops: Array.from({ length: 12 }, (_, j) => ({ key: 'k' + ((r * 41 + j * 7 + days.indexOf(day)) % 5118), loadSeq: j + 1 })) }));
  const t = process.hrtime.bigint();
  const rm = S.routeMasterOf(PLANT, { customers, routeDays, meta: {} });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(rm.counts.stops > 6000, 'stops: ' + rm.counts.stops);
  assert.ok(!rm.rows.some(r => customers['k' + (Number(r.account) - 10000)].inactive));
  assert.ok(ms < 200, 'took ' + ms + ' ms');
  assert.ok(Buffer.byteLength(JSON.stringify(rm)) < 900000, 'fits in one database record');
});
