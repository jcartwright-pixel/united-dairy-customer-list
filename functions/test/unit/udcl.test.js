'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');

// Joe 11/1: the United Dairy Customer List. Made-up customers only.

// A small stand-in for the database: collection / doc / get / set / where / transactions / batches.
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  let n = 0;
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined) });
  const ref = (col, id) => ({ id, path: col + '/' + id, get: async () => snap(col + '/' + id), set: async (v) => { docs.set(col + '/' + id, JSON.parse(JSON.stringify(v))); }, delete: async () => { docs.delete(col + '/' + id); } });
  const collection = (col) => ({
    doc: (id) => ref(col, id === undefined ? 'auto' + (++n) : id),
    add: async (v) => { const r = ref(col, 'auto' + (++n)); await r.set(v); return r; },
    where: (field, op, value) => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(col + '/') && k.split('/').length === 2 && docs.get(k)[field] === value).map(k => snap(k)) }) })
  });
  const db = {
    docs,
    collection,
    getAll: async (...refs) => refs.map(r => snap(r.path)),
    batch: () => { const ops = []; return { set: (r, v) => ops.push(() => r.set(v)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: async (r) => snap(r.path), getAll: async (...refs) => refs.map(r => snap(r.path)), set: (r, v) => writes.push([r, v]) };
      const out = await fn(tx);
      for (const [r, v] of writes) await r.set(v);
      return out;
    }
  };
  return db;
}
const PLANT = 'fac_uniontown';
const people = {
  'users/boss@example.com': { status: 'ACTIVE', roles: ['ADMINISTRATOR'], facilities: ['*'] },
  'users/mgr@example.com': { status: 'ACTIVE', roles: ['MANAGER'], facilities: [PLANT] },
  'users/disp@example.com': { status: 'ACTIVE', roles: ['DISPATCHER'], facilities: [PLANT] }
};
const boss = { email: 'boss@example.com' }, mgr = { email: 'mgr@example.com' }, disp = { email: 'disp@example.com' };
const now = { now: () => new Date('2026-11-01T12:00:00Z') };

// The Route Menu's Customer By Route tab, made up: a heading row, then DAY, ROUTE, Chain, Account, Name, two load columns.
const MENU = [
  ['DAY', 'ROUTE', 'Chain', 'Account', 'Name', null, null],
  ['TUE', 900, 0, 5001, 'ACME MARKET', 3, 3],
  ['TUE', 900, 415, 5002, 'BEST FOODS #2', 1, 1],
  ['TUE', 900, 0, 5003.0, 'CORNER STORE *COD*', 7, 0],
  ['FRI', 900, 0, 5001, 'ACME MARKET', 2, 2],
  ['WED', 901, 0, 5004, 'DAIRY DELITE', null, null],
  ['TUE', 900, 0, 5001, 'ACME MARKET', 3, 3],
  ['DAY', 'RT', 'CHAIN', 'ACCOUNT', 'NAME', null, 'LOAD SEQ'],
  ['FRI', null, 0, 5005, 'NO ROUTE YET', 3, 3]
];

test('the Route Menu tab is read: day, route, account, chain, load sequence; repeats once; no route kept apart', () => {
  const m = U.menuStops(MENU);
  assert.equal(m.stops.length, 5);
  assert.deepEqual(m.stops[0], { day: 'TUE', route: '900', account: '5001', chain: '0', name: 'ACME MARKET', loadSeq: 3, key: '5001' });
  assert.equal(m.stops[1].chain, '415');
  assert.equal(m.stops[2].account, '5003');
  assert.equal(m.stops[2].loadSeq, 7, 'a 0 typed over the load column falls back to the one before');
  assert.equal(m.stops[4].loadSeq, 0);
  assert.deepEqual(m.unrouted.map(x => x.name), ['NO ROUTE YET']);
  assert.equal(U.menuStops([['nothing here']]), null);
});

test('addresses by account, GPS addresses by name, and the Route Book with its truck drawing', () => {
  const a = U.addressList([[null], [1, 0, 5001, 'ACME MARKET', '1 MAIN ST', '1 MAIN ST', 'TOWN,', 'pa', 15401]]);
  assert.deepEqual(a['5001'], { address: '1 MAIN ST', address2: '', city: 'TOWN', state: 'PA', zip: '15401' });
  const g = U.gpsAddresses([['Name', 'Address', 'City', 'State', 'Route', 'Lat', 'Lon'], ["Kelly`s Cones", '2 Oak Rd', 'Elm', 'PA', 901, 39.9, -79.7]]);
  assert.equal(g[U.nameKey("KELLYS CONES")].lat, 39.9);
  const row = (n) => { const r = new Array(26).fill(null); [13, 15, 17, 21, 23, 25].forEach(c => { r[c] = n; }); return r; };
  const sheet = [
    ['Tuesday', null, null, null, null, null, null, 'Start Time 4:00 AM'],
    ['Chain', 'Account', 'Name', 'Run Order', 'Load SEQ'],
    [0, 5002, 'BEST FOODS #2', 1, 1, null, null, null, 'Key on ring'],
    [0, 5001, 'ACME MARKET', 2, 3],
    Object.assign(row(1), { 0: null }), [], Object.assign(new Array(26).fill(null), { 13: 'Side Door' }), row(3), [],
    ['Instructions'], ['Call before you get there']
  ];
  const b = U.routeBook({ 'Rt 900': sheet, 'Sheet1': [] });
  assert.deepEqual(Object.keys(b), ['900|TUE']);
  assert.equal(b['900|TUE'].startTime, '4:00 AM');
  assert.deepEqual(b['900|TUE'].stops.map(s => [s.account, s.run, s.keys]), [['5002', 1, 'Key on ring'], ['5001', 2, '']]);
  assert.deepEqual(b['900|TUE'].instructions, ['Call before you get there']);
  assert.equal(b['900|TUE'].grid.length, 2);
  assert.equal(b['900|TUE'].door, 1);
});

test('run order: the Route Book where it fits, else from the back door in; a saved order is kept and new stops slot in by load', () => {
  const stops = U.menuStops(MENU).stops.filter(s => s.route === '900' && s.day === 'TUE');
  assert.deepEqual(U.runOrder(stops, null, null).map(s => s.key), ['5003', '5001', '5002'], 'highest load number comes off first');
  const book = { stops: [{ account: '5002', name: 'BEST FOODS #2', run: 1 }, { account: '5001', name: 'ACME MARKET', run: 2 }] };
  assert.deepEqual(U.runOrder(stops, null, book).map(s => s.key), ['5002', '5001', '5003']);
  assert.deepEqual(U.runOrder(stops, ['5002', '5001'], null).map(s => s.key), ['5003', '5002', '5001'], 'a new stop with load 7 goes before the ones with lower loads');
});

test('load maps: rows shared out front first, the Route Book drawing only when its numbers still match, saved maps cleaned', () => {
  const stops = [{ loadSeq: 1 }, { loadSeq: 1 }, { loadSeq: 2 }, { loadSeq: 0 }];
  const m = U.autoMap(stops);
  assert.equal(m.rows, 12);
  assert.deepEqual(m.cells[0], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(m.cells[11], [2, 2, 2, 2, 2, 2]);
  assert.equal(U.mapCounts(m)[1], 48);
  assert.equal(U.bookMap({ grid: [[1, 1, 1, 2, 2, 2]], door: null }, stops).rows, 1);
  assert.equal(U.bookMap({ grid: [[9, 9, 9, 9, 9, 9]] }, stops), null);
  const c = U.cleanMap({ rows: 99, door: 'x', cells: [['3', 'a', -1]] });
  assert.equal(c.rows, U.MAX_ROWS);
  assert.deepEqual(c.cells[0], [3, null, null, null, null, null]);
  assert.equal(c.door, null);
  // The database holds no list inside a list: each row is kept as words, and read back the same.
  const packed = U.packMap(m);
  assert.equal(packed.cells[0], '1,1,1,1,1,1');
  assert.ok(packed.cells.every(r => typeof r === 'string'));
  assert.deepEqual(U.cleanMap(packed), m);
});

test('the lists by customer, route and day, filtered and sorted', () => {
  const customers = { a: { key: 'a', name: 'ZED MART', account: '2', city: 'ELM' }, b: { key: 'b', name: 'ALPHA', account: '1', city: 'OAK' } };
  const rds = [{ route: '901', day: 'MON', stops: [{ key: 'a', loadSeq: 2 }, { key: 'b', loadSeq: 1 }] }, { route: '900', day: 'FRI', stops: [{ key: 'a', loadSeq: 1 }] }];
  const lines = U.lines(customers, rds);
  assert.deepEqual(U.pick(lines, { sort: 'route' }).map(l => l.route + l.day + l.stop), ['900FRI1', '901MON1', '901MON2']);
  assert.deepEqual(U.pick(lines, { sort: 'customer' }).map(l => l.name), ['ALPHA', 'ZED MART', 'ZED MART']);
  assert.deepEqual(U.pick(lines, { q: 'oak' }).map(l => l.key), ['b']);
  assert.deepEqual(U.pick(lines, { day: 'FRI' }).map(l => l.key), ['a']);
  const rows = U.customerRows(customers, lines);
  assert.deepEqual(rows.find(r => r.key === 'a').days, ['MON', 'FRI']);
  assert.equal(U.dayLetters(['MON', 'FRI']), '- M - - - F -');
  assert.equal(U.addressLine({ address: '1 Main', city: 'Elm', state: 'PA', zip: '15401' }), '1 Main, Elm, PA 15401');
});

async function imported() {
  const db = fakeDb(people);
  const m = U.menuStops(MENU);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: { 5001: { address: '1 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401' } }, gps: {},
    book: { '900|TUE': { startTime: '4:00 AM', instructions: ['Call first'], stops: [{ account: '5002', name: 'BEST FOODS #2', run: 1, keys: 'Ring 4' }], grid: [] } }, fileName: 'menu.xlsb' }, now);
  return { db, out };
}

test('an import makes the customers and route days, with the Route Book\'s start time, keys and instructions', async () => {
  const { db, out } = await imported();
  assert.equal(out.counts.customers, 5);
  assert.equal(out.counts.routeDays, 3);
  assert.equal(out.counts.noLoadSeq, 1);
  const v = await S.udclCall(db, disp, PLANT, { op: 'view' });
  assert.equal(v.canEdit, false);
  assert.equal(v.customers['5001'].address, '1 MAIN ST');
  assert.equal(v.customers['5002'].keys, 'Ring 4');
  const tue = v.routeDays.find(r => r.route === '900' && r.day === 'TUE');
  assert.equal(tue.startTime, '4:00 AM');
  assert.equal(tue.notes, 'Call first');
  assert.equal(tue.map.rows, 12);
  assert.ok([...db.docs.values()].every(d => !d.map || d.map.cells.every(r => typeof r === 'string')), 'no list inside a list is saved');
  assert.equal(v.imported.fileName, 'menu.xlsb');
  assert.equal(v.customers['5001'].dc, U.PLANT_DC[PLANT], 'a plant\'s customers start with its distribution center code');
});

test('distribution center codes: written the one way; a DC with no name here keeps its number (Joe 11/2: every DC imported)', () => {
  assert.equal(U.dcOf('030'), '30');
  assert.equal(U.dcOf(50), '50');
  assert.equal(U.dcOf('61'), '61');
  assert.equal(U.dcOf('Uniontown'), '');
  assert.equal(U.dcName('61'), '61 DC 61');
  assert.equal(U.dcName('1'), '1 Martins Ferry');
  assert.equal(U.dcName(''), '');
  assert.deepEqual(U.cleanCustomer({ dc: '7', name: 'X' }), { name: 'X', dc: '7' });
  assert.equal(U.PLANT_DC.fac_uniontown, '30');
});

test('only an Administrator or Manager changes the order, the rev stops two people saving over each other, and the import keeps it', async () => {
  const { db } = await imported();
  const tue = () => S.udclCall(db, mgr, PLANT, { op: 'view' }).then(v => v.routeDays.find(r => r.route === '900' && r.day === 'TUE'));
  const before = await tue();
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', stops: [] }), /Administrator or Manager/);
  const order = before.stops.map(s => ({ key: s.key, loadSeq: s.loadSeq, note: '' })).reverse();
  order[0].note = 'Back door only';
  const saved = await S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', rev: before.rev, stops: order, startTime: '3:30 AM' }, now);
  assert.equal(saved.routeDay.rev, before.rev + 1);
  assert.equal(saved.routeDay.updatedBy, 'mgr@example.com');
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', rev: before.rev, stops: order }), /Someone else changed/);
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', stops: [{ key: 'nobody' }] }), /not on the customer list/);
  // Importing again keeps the order, the note and the start time.
  const m = U.menuStops(MENU);
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted }, now);
  const after = await tue();
  assert.deepEqual(after.stops.map(s => s.key), order.map(s => s.key));
  assert.equal(after.stops[0].note, 'Back door only');
  assert.equal(after.startTime, '3:30 AM');
  // A dispatcher may not import.
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'importMenu', stops: m.stops }), /Only an administrator/);
});

test('Joe 11/1: a new upload overrules what was changed here; what the files do not have stays as typed', async () => {
  const { db } = await imported();
  const tue = () => S.udclCall(db, mgr, PLANT, { op: 'view' }).then(v => v.routeDays.find(r => r.route === '900' && r.day === 'TUE'));
  const before = await tue();
  const order = before.stops.map(s => ({ key: s.key, loadSeq: s.loadSeq, note: s.key === '5001' ? 'Side door' : '' })).reverse();
  await S.udclCall(db, mgr, PLANT, { op: 'saveRouteDay', route: '900', day: 'TUE', rev: before.rev, stops: order, startTime: '3:30 AM' }, now);
  await S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', key: '5001', fields: { address: '9 TYPED RD', phone: '555-0101' } }, now);
  const m = U.menuStops(MENU);
  const book = { '900|TUE': { startTime: '5:00 AM', instructions: ['New gate code'], stops: [{ account: '5002', name: 'BEST FOODS #2', run: 1 }, { account: '5001', name: 'ACME MARKET', run: 2 }, { account: '5003', name: 'CORNER STORE *COD*', run: 3 }], grid: [] } };
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: { 5001: { address: '1 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401' } }, gps: {}, book }, now);
  const after = await tue(), v = await S.udclCall(db, mgr, PLANT, { op: 'view' });
  assert.deepEqual(after.stops.map(s => s.key), ['5002', '5001', '5003'], 'the Route Book\'s run order wins');
  assert.equal(after.startTime, '5:00 AM');
  assert.equal(after.notes, 'New gate code');
  assert.equal(v.customers['5001'].address, '1 MAIN ST', 'the uploaded address wins');
  assert.equal(v.customers['5001'].phone, '555-0101', 'a phone the files do not have stays');
  assert.equal(after.stops.find(s => s.key === '5001').note, 'Side door', 'a stop note stays');
});

test('Joe 11/2: Edit on Route Book moves a stop to other days and another route, or takes it off', async () => {
  const { db } = await imported();
  const view = () => S.udclCall(db, mgr, PLANT, { op: 'view' });
  const rd = (v, r, d) => v.routeDays.find(x => x.route === r && x.day === d);
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'placeStop', key: '5001', from: '900', days: [] }), /Administrator or Manager/);
  // ACME is on 900 Tuesday and Friday: keep Tuesday (load 4, a note), add Wednesday (a new day for 900), take Friday off.
  const out = await S.udclCall(db, mgr, PLANT, { op: 'placeStop', key: '5001', from: '900', route: '900', day: 'TUE', days: ['TUE', 'WED'], loadSeq: 4, note: 'Side door' }, now);
  assert.equal(out.changed.length, 3);
  let v = await view();
  assert.deepEqual(rd(v, '900', 'TUE').stops.find(s => s.key === '5001'), Object.assign({}, rd(v, '900', 'TUE').stops.find(s => s.key === '5001'), { loadSeq: 4, note: 'Side door' }));
  assert.equal(rd(v, '900', 'WED').stops[0].key, '5001');
  assert.equal(rd(v, '900', 'WED').stops[0].loadSeq, 4);
  assert.ok(rd(v, '900', 'WED').map, 'a new route day gets a load map');
  assert.equal(rd(v, '900', 'FRI').stops.some(s => s.key === '5001'), false);
  // Joe 11/2 "Move to another route": move Wednesday only to 902 (stay on 900 Tuesday), then bring it back.
  await S.udclCall(db, mgr, PLANT, { op: 'placeStop', key: '5001', from: '900', route: '902', day: 'WED', days: ['WED'], stay: ['TUE'] }, now);
  v = await view();
  assert.equal(rd(v, '900', 'TUE').stops.some(s => s.key === '5001'), true, 'Tuesday stays on 900');
  assert.equal(rd(v, '900', 'WED').stops.some(s => s.key === '5001'), false);
  assert.deepEqual(rd(v, '902', 'WED').stops.map(s => s.key), ['5001']);
  await S.udclCall(db, mgr, PLANT, { op: 'placeStop', key: '5001', from: '902', route: '900', day: 'WED', days: ['WED'] }, now);
  // Move it to route 901 on Wednesday: off 900 everywhere, on 901 Wednesday (load 4 goes before DAIRY DELITE, which has none).
  await S.udclCall(db, mgr, PLANT, { op: 'placeStop', key: '5001', from: '900', route: '901', day: 'TUE', days: ['WED'] }, now);
  v = await view();
  assert.equal(rd(v, '900', 'TUE').stops.some(s => s.key === '5001'), false);
  assert.equal(rd(v, '900', 'WED').stops.length, 0);
  assert.deepEqual(rd(v, '901', 'WED').stops.map(s => s.key), ['5001', '5004']);
  // No days: off the route.
  await S.udclCall(db, mgr, PLANT, { op: 'placeStop', key: '5001', from: '901', days: [] }, now);
  v = await view();
  assert.deepEqual(rd(v, '901', 'WED').stops.map(s => s.key), ['5004']);
});

test('a route day off the Route Menu is removed and its customer no longer active; customers are added and changed', async () => {
  const { db } = await imported();
  const m = U.menuStops(MENU.filter(r => r[1] !== 901));
  const out = await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted }, now);
  assert.equal(out.counts.removedDays, 1);
  assert.equal(out.counts.inactive, 1);
  const v = await S.udclCall(db, mgr, PLANT, { op: 'view' });
  assert.equal(v.customers['5004'].active, false);
  const add = await S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', add: true, account: '6000', fields: { name: 'New Shop', city: 'Elm' } }, now);
  assert.equal(add.customer.key, '6000');
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', add: true, account: '6000', fields: { name: 'Again' } }), /already on the list/);
  const ch = await S.udclCall(db, mgr, PLANT, { op: 'saveCustomer', key: '6000', fields: { phone: '555-0100', state: 'pa' } }, now);
  assert.equal(ch.customer.phone, '555-0100');
  assert.equal(ch.customer.state, 'PA');
  assert.equal(ch.customer.city, 'Elm');
});

test('the bridges: the Sales app reads its lines from the Customer List, and the phone gets the route book', async () => {
  const { db } = await imported();
  const sales = await S.salesRows(db, PLANT);
  assert.equal(sales.rows.filter(r => r.route).length, 5);
  assert.ok(sales.rows.some(r => r.name === 'NO ROUTE YET' && !r.route));
  assert.equal(await S.salesRows(db, 'fac_charleston'), null, 'a plant with no Customer List keeps the Sales app upload');
  const book = await S.routeBook(db, PLANT, '900_2', 'tue');
  assert.equal(book.found, true);
  assert.equal(book.startTime, '4:00 AM');
  assert.equal(book.stops[0].stop, 1);
  assert.ok(book.stops.some(s => s.address === '1 MAIN ST, TOWN, PA 15401'));
  assert.equal((await S.routeBook(db, PLANT, '900 TOWN', 'TUE')).found, true, 'a route named with words around its number');
  assert.equal((await S.routeBook(db, PLANT, '999', 'TUE')).found, false);
});

test('someone not on the Users list, or not at the plant, is refused', async () => {
  const db = fakeDb(people);
  await assert.rejects(S.udclCall(db, { email: 'stranger@example.com' }, PLANT, { op: 'view' }), /not on the Users list/);
  await assert.rejects(S.udclCall(db, mgr, 'fac_charleston', { op: 'view' }), /not set up for/);
});

test('Joe 11/2: a PO box, mailbox, RR box or c/o is not a ship-to address', () => {
  ['P.O. BOX 434', 'P O BOX 69', 'PO BOX 215', 'R.R. 4 BOX 82', 'R. D. #2, BOX 300', 'BOX 3, ROUTE 88', 'NUTRITION INC.C/O A.G. SCHOOLS', 'P.C.N. C/O UNIONTOWN SCHOOLS', 'MAILBOX 12']
    .forEach(a => assert.equal(U.notStreet(a), true, a));
  ['3349 PITTSBURGH ST', '7857 SANG RUN ROAD', 'ROUTE 88', '1 BOXWOOD LN', '24 POST RD', '100 CO-OP WAY', 'BOXER ST']
    .forEach(a => assert.equal(U.notStreet(a), false, a));
});

test('Joe 11/2: checked addresses are loaded and stay through the next upload; an upload never swaps a street for a PO box', async () => {
  const { db } = await imported();
  const out = await S.loadAddresses(db, PLANT, [
    { key: '5002', address: '3349 PITTSBURGH ST', city: 'PERRYOPOLIS', state: 'pa', zip: '15473', confidence: 'high', source: 'store site' },
    { key: '5003', address: 'P.O. BOX 9', city: 'TOWN', state: 'PA' },
    { key: '9999', address: '1 NOWHERE RD', city: 'X', state: 'PA' }
  ], 'loader@workflow', now);
  assert.deepEqual(out, { changed: 1, same: 0, missing: 1, refused: 1 });
  let v = await S.udclCall(db, disp, PLANT, { op: 'view' });
  assert.equal(v.customers['5002'].address, '3349 PITTSBURGH ST');
  assert.equal(v.customers['5002'].state, 'PA');
  assert.equal(v.customers['5002'].addressChecked, true);
  const m = U.menuStops(MENU);
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted,
    addresses: { 5001: { address: 'P.O. BOX 1', city: 'TOWN', state: 'PA' }, 5002: { address: '99 WRONG ST', city: 'ELSEWHERE', state: 'KY' }, 5003: { address: '5 OAK ST', address2: 'PO BOX 77', city: 'TOWN', state: 'PA' } }, gps: {} }, now);
  v = await S.udclCall(db, disp, PLANT, { op: 'view' });
  assert.equal(v.customers['5002'].address, '3349 PITTSBURGH ST', 'a checked address stays through the upload');
  assert.equal(v.customers['5002'].city, 'PERRYOPOLIS');
  assert.equal(v.customers['5001'].address, '1 MAIN ST', 'a PO box does not replace a street address');
  assert.equal(v.customers['5003'].address, '5 OAK ST', 'an unchecked street address still comes from the upload');
  assert.equal(v.customers['5003'].address2, '', 'a PO box second line is left off');
  assert.equal((await S.loadAddresses(db, PLANT, [{ key: '5002', address: '3349 PITTSBURGH ST', city: 'PERRYOPOLIS', state: 'PA', zip: '15473', confidence: 'high', source: 'store site' }], 'loader@workflow', now)).same, 1);
});

test('Import Addresses reads a sheet of checked addresses by its headings; only an administrator imports it', async () => {
  const rows = U.checkedAddressRows([
    ['Status', 'Confidence', 'Account', 'Chain', 'Customer', 'Ship-to street', 'City', 'State', 'Zip', 'Where it came from'],
    ['looked up', 'high', 5002, 415, 'BEST FOODS #2', '3349 Pittsburgh St', 'Perryopolis', 'pa', 15473, 'store site'],
    ['', '', '', '', 'no account', '1 X St', 'Y', 'PA', '', ''],
    ['', '', 5003, '', 'no street', '', 'Y', 'PA', '', '']
  ]);
  assert.deepEqual(rows, [{ key: '5002', address: '3349 Pittsburgh St', address2: '', city: 'Perryopolis', state: 'PA', zip: '15473', confidence: 'high', source: 'store site' }]);
  assert.deepEqual(U.checkedAddressRows([['DAY', 'ROUTE']]), []);
  const { db } = await imported();
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'importAddresses', rows }), /Only an administrator/);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importAddresses', rows }, now);
  assert.equal(out.counts.changed, 1);
  assert.match(out.message, /stay through the next Route Menu upload/);
});

test('Joe 11/2: the company full list adds missing customers of this plant\'s DC, fills chain and address, keeps routes and checked addresses', async () => {
  // Made-up rows: headings DC, CHAIN, ACCOUNT, NAME then headerless street, street again, city, state, zip.
  const rows = U.fullListRows([
    ['DC', 'CHAIN', 'ACCOUNT', 'NAME', null, null, null, null, null],
    [1, 0, 5001, 'OTHER DC STORE', '9 FAR RD', '9 FAR RD', 'FARTOWN', 'OH ', 43950],
    [30, 0, 5001, 'ACME MARKET', 'PO BOX 12', 'PO BOX 12', 'TOWN', 'PA', 15401],
    [30, 415, 5002, 'BEST FOODS #2', '22 OAK AVE', '22 OAK AVE', 'MAPLETON', 'pa', 15401],
    [30, 0, 7777, 'NEW CORNER SHOP', '5 ELM ST', 'SUITE 2', 'MAPLETON', 'PA', '15401']
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3], { dc: '30', chain: '0', account: '7777', name: 'NEW CORNER SHOP', address: '5 ELM ST', address2: 'SUITE 2', city: 'MAPLETON', state: 'PA', zip: '15401' });
  assert.equal(rows[0].dc, '1');
  assert.equal(rows[2].address2, '', 'the same street twice is one street');
  const { db } = await imported();
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'importFullList', rows }), /Only an administrator/);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows }, now);
  // Joe 11/2: "I want all 5,066 rows imported": the other DC's customer comes in too, kept apart by its DC (same account 5001).
  assert.deepEqual([out.counts.read, out.counts.added, out.counts.otherDc], [4, 2, 1]);
  let v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.equal(v.customers['7777'].name, 'NEW CORNER SHOP');
  assert.equal(v.customers['7777'].chain, '0');
  assert.equal(v.customers['7777'].dc, '30');
  assert.equal(v.customers['D1-5001'].name, 'OTHER DC STORE');
  assert.equal(v.customers['D1-5001'].dc, '1');
  assert.equal(v.customers['5001'].name, 'ACME MARKET', 'the same account in another DC does not touch this one');
  // A group picked on the Directory goes to the Sales app with the customer's lines.
  await S.udclCall(db, boss, PLANT, { op: 'saveCustomer', key: '5002', fields: { group: "Best's Stores" } }, now);
  const sales = await S.salesRows(db, PLANT);
  assert.equal(sales.rows.find(r => r.account === '5002').group, "Best's Stores");
  assert.equal(v.customers['5001'].address, '1 MAIN ST', 'a PO box never replaces a street');
  assert.equal(v.customers['5002'].address, '22 OAK AVE');
  assert.ok(v.routeDays.some(rd => (rd.stops || []).some(s => s.key === '5002')), 'routes are kept');
  // The next Route Menu upload does not mark a full-list customer with no route as gone.
  const m = U.menuStops(MENU);
  await S.udclCall(db, boss, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: {}, gps: {}, book: {}, fileName: 'menu.xlsb' }, now);
  v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.notEqual(v.customers['7777'].active, false);
});

test('Joe 11/2: the master file ("Replace whatever I have with this") replaces name, chain and address, adds GPS and the address check, keeps routes and groups, and clears an earlier list', async () => {
  const H = ['DC', 'Chain', 'Account', 'Customer', 'Original street', 'Original second line', 'Original city', 'Original state', 'Original ZIP', 'Matched address', 'Address changed?', 'Latitude', 'Longitude', 'Match status', 'Match quality', 'Coordinate source', 'Change details', 'Review notes'];
  const first = U.fullListRows([['DC', 'CHAIN', 'ACCOUNT', 'NAME'], [30, 0, 8888, 'OLD LIST STORE', '1 GONE RD', '', 'NOWHERE', 'PA', 15401]]);
  const rows = U.fullListRows([H,
    ['30', '415', '5002', 'BEST FOODS #2 MAPLETON', '22 OAK AVE', '22 OAK AVE', 'MAPLETON', 'PA', '15401', '22 OAK AVE, MAPLETON, PA, 15401', 'No', 40.1, -79.7, 'Street address matched', 'Exact', 'US Census', '', ''],
    ['30', '418', '5002', 'BEST FOODS #2 ANNEX', '24 OAK AVE', '', 'MAPLETON', 'PA', '15401', '', 'Not established', null, null, 'No address match', '', '', '', 'Look it up'],
    ['1', '0', '50', 'FAR STORE', '9 FAR RD', '', 'FARTOWN', 'OH', '43950', '9 FAR ROAD, FARTOWN, OH, 43950', 'Yes', 40.0, -80.9, 'Address match needs review', 'Non_Exact', 'US Census', '', 'Confirm'],
    [null, null, null, 'A MAP POINT ONLY', '1 X ST', '', 'Y', 'PA', '1', '', '', 40, -80, 'Verizon saved location', '', '', '', '']
  ]);
  assert.equal(rows.length, 3, 'a map point with no DC or account is not a customer');
  assert.deepEqual([rows[0].lat, rows[0].check, rows[2].proposed], [40.1, 'Street address matched', '9 FAR ROAD, FARTOWN, OH, 43950']);
  const { db } = await imported();
  await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows: first }, now);
  await S.udclCall(db, boss, PLANT, { op: 'saveCustomer', key: '5002', fields: { group: "Best's Stores", phone: '555-0100' } }, now);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows }, now);
  assert.equal(out.counts.removed, 1);
  const v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.equal(v.customers['8888'], undefined, 'a customer only on the earlier list, with no route, is gone');
  const c = v.customers['5002'];
  assert.deepEqual([c.name, c.chain, c.lat, c.addressCheck, c.group, c.phone], ['BEST FOODS #2 MAPLETON', '415', 40.1, 'Street address matched', "Best's Stores", '555-0100']);
  assert.ok(v.routeDays.some(rd => (rd.stops || []).some(s => s.key === '5002')), 'routes are kept');
  assert.equal(v.customers['5002-C418'].name, 'BEST FOODS #2 ANNEX', 'the same account under another chain is its own customer');
  assert.equal(v.customers['5002-C418'].addressNote, 'Look it up');
  assert.equal(v.customers['D1-50'].addressProposed, '9 FAR ROAD, FARTOWN, OH, 43950');
});
