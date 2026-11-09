'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');

// Joe 11/1: the United Dairy Customer List. Made-up customers only.

const { fakeDb } = require('./fake-db.cjs');
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
  // Joe 11/3: route numbers in the DC column (above 80, and 0, 8, 11, 12, 14) are not branches; they are Marietta's customers.
  assert.equal(U.branchOf('103'), '9'); assert.equal(U.dcRoute('103'), '103'); assert.equal(U.dcName('112'), '9 Marietta');
  ['0', '8', '12', '14', '234', '605'].forEach(v => { assert.equal(U.branchOf(v), '9', v); assert.equal(U.dcRoute(v), v, v); });
  assert.equal(U.branchOf('815'), '30', 'route 815 is on the Uniontown Route Menu'); assert.equal(U.dcRoute('815'), '815');
  assert.equal(U.branchOf(''), '');
  ['1', '6', '7', '9', '30', '50', '61', '80'].forEach(v => { assert.equal(U.branchOf(v), v, v); assert.equal(U.dcRoute(v), '', v); });
  assert.equal(U.dcRoute('30'), ''); assert.equal(U.dcRoute(''), '');
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
  assert.deepEqual(rows, [{ key: '5002', address: '3349 Pittsburgh St', address2: '', city: 'Perryopolis', state: 'PA', zip: '15473', confidence: 'high', source: 'store site', dc: '', name: 'BEST FOODS #2', chain: '415' }]);
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

test('Joe 11/2: the master file ("Replace whatever I have with this") replaces name, chain and address, adds GPS and the address check, keeps routes and groups; Joe 11-8-26 (Update the file): a customer the file does not have is never removed', async () => {
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
  assert.equal(out.counts.removed, 0);
  assert.match(out.message, /Nobody was removed/);
  const v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.equal(v.customers['8888'].name, 'OLD LIST STORE', 'a customer only on the earlier list stays as it is');
  const c = v.customers['5002'];
  assert.deepEqual([c.name, c.chain, c.lat, c.addressCheck, c.group, c.phone], ['BEST FOODS #2 MAPLETON', '415', 40.1, 'Street address matched', "Best's Stores", '555-0100']);
  assert.ok(v.routeDays.some(rd => (rd.stops || []).some(s => s.key === '5002')), 'routes are kept');
  assert.equal(v.customers['5002-C418'].name, 'BEST FOODS #2 ANNEX', 'the same account under another chain is its own customer');
  assert.equal(v.customers['5002-C418'].addressNote, 'Look it up');
  assert.equal(v.customers['D1-50'].addressProposed, '9 FAR ROAD, FARTOWN, OH, 43950');
});

test('Joe 11/2: Import Addresses with a DC column finds the customer by DC and account, never a Uniontown customer with the same number', async () => {
  const sheet = [['DC', 'Account', 'Customer', 'Street', 'City', 'State', 'Zip', 'Confidence', 'Source'],
    [1, 5001, 'OTHER DC STORE', '12 RIVER RD', 'FARTOWN', 'OH', 43950, 'high', 'store site'],
    [30, 5002, 'BEST FOODS #2', '3349 PITTSBURGH ST', 'PERRYOPOLIS', 'PA', 15473, 'high', 'store site']];
  assert.deepEqual(U.fullListRows(sheet), [], 'a looked-up address sheet is not the master list');
  const rows = U.checkedAddressRows(sheet);
  assert.equal(rows[0].dc, '1');
  const { db } = await imported();
  await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows: U.fullListRows([['DC', 'CHAIN', 'ACCOUNT', 'NAME'], [1, 0, 5001, 'OTHER DC STORE', '9 FAR RD', '', 'FARTOWN', 'OH', 43950]]) }, now);
  const out = await S.udclCall(db, boss, PLANT, { op: 'importAddresses', rows }, now);
  assert.equal(out.counts.changed, 2);
  const v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.equal(v.customers['D1-5001'].address, '12 RIVER RD');
  assert.equal(v.customers['5001'].address, '1 MAIN ST', 'Uniontown 5001 is not touched');
  assert.equal(v.customers['5002'].address, '3349 PITTSBURGH ST');
  // A master upload afterwards keeps the looked-up address.
  await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows: U.fullListRows([['DC', 'CHAIN', 'ACCOUNT', 'NAME'], [1, 0, 5001, 'OTHER DC STORE', '9 FAR RD', '', 'FARTOWN', 'OH', 43950]]) }, now);
  assert.equal((await S.udclCall(db, boss, PLANT, { op: 'view' })).customers['D1-5001'].address, '12 RIVER RD');
});

test('Joe 11/2: the master list reads Phone, Contact and Group when the file has them; a blank cell is left out', () => {
  const U = require('../../src/udcl-rules');
  const rows = U.fullListRows([['DC', 'Chain', 'Account', 'Customer', 'Street', 'City', 'State', 'Zip', 'Phone', 'Group'],
    [30, 0, 1196, 'ACORN CORNER MARKET', '12 ELM ST', 'MAPLETON', 'PA', 15401, '555-0199', 'Corner Stores'],
    [30, 0, 1984, 'QUICK STOP', '4 OAK RD', 'MAPLETON', 'PA', 15401, null, '']]);
  assert.equal(rows[0].phone, '555-0199'); assert.equal(rows[0].group, 'Corner Stores');
  assert.equal(rows[1].phone, undefined); assert.equal(rows[1].group, undefined);
});

test('Joe 11/2: a master list with a City heading and no second-line column leaves the second line empty', () => {
  const rows = U.fullListRows([['DC', 'Chain', 'Account', 'Customer', 'Street', 'City', 'State', 'Zip'], [30, 0, 1196, 'ACORN CORNER MARKET', '12 ELM ST', 'MAPLETON', 'PA', 15401]]);
  assert.equal(rows[0].address2, ''); assert.equal(rows[0].city, 'MAPLETON'); assert.equal(rows[0].zip, '15401');
});

test('Joe 11/2: an inactive customer shows nowhere else: not on the screens, the Sales app or the route days; only an administrator sets it', async () => {
  const { db } = await imported();
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'setStatus', keys: ['5001'], inactive: true }, now), /administrator/);
  const out = await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['5001'], inactive: true }, now);
  assert.equal(out.customers['5001'].inactive, true); assert.equal(out.customers.length, undefined); assert.equal(out.routeDays.length, 2, 'only the route days it left come back');
  assert.deepEqual(out.removedFrom.sort(), ['route 900 Friday', 'route 900 Tuesday']);
  const v = await S.udclCall(db, boss, PLANT, { op: 'view' });
  assert.equal(v.customers['5001'], undefined); assert.equal(v.inactiveHidden, 1);
  assert.ok(v.routeDays.every(rd => rd.stops.every(s => s.key !== '5001')));
  assert.equal((await S.udclCall(db, boss, PLANT, { op: 'view', all: true })).customers['5001'].inactive, true, 'the Master Customer List has it');
  assert.equal((await S.udclCall(db, mgr, PLANT, { op: 'view', all: true })).customers['5001'], undefined, 'only for an administrator');
  assert.ok(!(await S.salesRows(db, PLANT)).rows.some(r => r.account === '5001'));
  const back = await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['5001'], inactive: false }, now);
  assert.match(back.message, /active again/);
  assert.ok((await S.udclCall(db, boss, PLANT, { op: 'view' })).customers['5001']);
});

test('Joe 11/3: many customers change in one call, and only they come back', async () => {
  const { db } = await imported();
  const v = await S.udclCall(db, boss, PLANT, { op: 'view', all: true });
  const keys = Object.keys(v.customers).slice(0, 3);
  const out = await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: keys.concat(['no-such-customer']), inactive: true }, now);
  assert.equal(out.changed, 3); assert.deepEqual(Object.keys(out.customers).sort(), keys.slice().sort());
  assert.equal(out.plant, undefined, 'not the whole list again');
  assert.match(out.message, /^3 customers are inactive now/);
  const again = await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys, inactive: true }, now);
  assert.equal(again.changed, 0); assert.match(again.message, /3 already were/);
  await assert.rejects(S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['no-such-customer'], inactive: true }, now), /not on the list/);
});

test('Joe 11/3: a name that starts with three periods is an inactive customer', () => {
  assert.equal(U.inactiveName('...ACME MARKET'), true); assert.equal(U.inactiveName(' ... ACME'), true);
  assert.equal(U.inactiveName('..ACME'), false); assert.equal(U.inactiveName('ACME...'), false); assert.equal(U.inactiveName(''), false);
});

test('Joe 11/3: once, a Uniontown customer on no route goes inactive, and a route customer filed under another DC is Uniontown\'s', async () => {
  const { db } = await imported();
  // The master list before 11/3: ACME (on route 900) under route number 815, BEST FOODS under DC 1, two Uniontown customers on no route, one of Lancaster's.
  await S.udclCall(db, boss, PLANT, { op: 'importFullList', rows: [
    { dc: '815', chain: '0', account: '5001', name: 'ACME MARKET', address: '1 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401', lat: 40.1, lon: -79.9, phone: '555-0101' },
    { dc: '1', chain: '415', account: '5002', name: 'BEST FOODS #2', address: '2 MAIN ST', city: 'TOWN', state: 'PA', zip: '15401' },
    { dc: '30', chain: '0', account: '7001', name: 'OLD MILL STORE', address: '7 MILL RD', city: 'TOWN', state: 'PA', zip: '15401' },
    { dc: '30', chain: '0', account: '7002', name: 'RIVER CAFE', address: '8 RIVER RD', city: 'TOWN', state: 'PA', zip: '15401' },
    { dc: '6', chain: '0', account: '7003', name: 'LANCASTER DELI', address: '9 HIGH ST', city: 'LANCASTER', state: 'OH', zip: '43130' }] }, now);
  let v = await S.udclCall(db, boss, PLANT, { op: 'view', all: true });
  assert.ok(!v.customers['D815-5001'], 'a new upload already files a route customer under Uniontown');
  assert.equal(v.customers['5001'].phone, '555-0101'); assert.equal(v.customers['5001'].dc, '30');
  // Live data from before that: copies under another DC (made by hand here, as the earlier upload made them).
  const copy = Object.assign({}, v.customers['5002'], { key: 'D1-5002', dc: '1', lat: 40.2, lon: -79.8, phone: '555-0102' });
  await db.collection('udclCustomers').doc(U.customerId(PLANT, 'D1-5002')).set(copy);
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'applyRouteRule' }, now), /administrator/);
  const out = await S.udclCall(db, boss, PLANT, { op: 'applyRouteRule' }, now);
  v = await S.udclCall(db, boss, PLANT, { op: 'view', all: true });
  assert.equal(v.customers['D1-5002'], undefined, 'the copy went into the route customer');
  assert.equal(v.customers['5002'].phone, '555-0102'); assert.equal(v.customers['5002'].lat, 40.2); assert.equal(v.customers['5002'].dc, '30');
  assert.equal(v.customers['7001'].inactive, true); assert.equal(v.customers['7002'].inactive, true);
  assert.equal(v.customers['D6-7003'].inactive, undefined, 'another branch is left alone');
  assert.equal(v.customers['5001'].inactive, undefined); assert.equal(v.customers['5004'].inactive, undefined, 'route customers stay active');
  assert.equal(out.merged.length, 1); assert.match(out.message, /inactive now; 1 on a Uniontown route/);
  assert.equal(v.routeRule.merged, 1);
  // Once only: switching one back stays switched.
  await S.udclCall(db, boss, PLANT, { op: 'setStatus', keys: ['7001'], inactive: false }, now);
  assert.equal((await S.udclCall(db, boss, PLANT, { op: 'applyRouteRule' }, now)).already, true);
  assert.equal((await S.udclCall(db, boss, PLANT, { op: 'view', all: true })).customers['7001'].inactive, undefined);
});

test('Joe 11/2: the master list reads an Active / Status column', () => {
  const rows = U.fullListRows([['Status', 'DC', 'Chain', 'Account', 'Customer', 'Street', 'City'], ['Inactive', 30, 0, 1, 'A', '1 X ST', 'T'], ['Active', 30, 0, 2, 'B', '2 X ST', 'T'], ['', 30, 0, 3, 'C', '3 X ST', 'T']]);
  assert.deepEqual(rows.map(r => r.inactive), [true, false, undefined]);
});

// Joe 11-3-26: Customers & Routes ticked or unticked per person in the United Dairy Hub's People & Access.
test('the hub\'s app ticks decide who opens Customers & Routes once saved', async () => {
  const db = fakeDb(people);
  await S.udclCall(db, disp, PLANT, { op: 'view' });
  db.docs.set('appAccess/disp@example.com', { apps: ['operations', 'fuel'] });
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'view' }), /do not have Customers & Routes/);
  db.docs.set('appAccess/disp@example.com', { apps: ['operations', 'customers'] });
  await S.udclCall(db, disp, PLANT, { op: 'view' });
});

test('Joe 11/3: groups are added, renamed and removed on Administration, and set on Customers one or many at a time', async () => {
  const { db } = await imported();
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'saveGroups', add: 'Corner Stores' }, now), /administrator/);
  let out = await S.udclCall(db, boss, PLANT, { op: 'saveGroups', add: 'Corner Stores' }, now);
  assert.deepEqual(out.groups, [{ name: 'Corner Stores', customers: 0 }]);
  await assert.rejects(S.udclCall(db, boss, PLANT, { op: 'saveGroups', add: 'corner stores' }, now), /already a group/);
  await S.udclCall(db, boss, PLANT, { op: 'saveGroups', add: 'Best Foods' }, now);
  assert.deepEqual((await S.udclCall(db, disp, PLANT, { op: 'view' })).groups, ['Best Foods', 'Corner Stores']);
  // A Manager sets the group, on one customer or many; only those customers come back.
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'setGroup', keys: ['5001'], group: 'Corner Stores' }, now), /Administrator or Manager/);
  const one = await S.udclCall(db, mgr, PLANT, { op: 'setGroup', keys: ['5001'], group: 'Corner Stores' }, now);
  assert.equal(one.customers['5001'].group, 'Corner Stores'); assert.match(one.message, /is in Corner Stores now/);
  const many = await S.udclCall(db, mgr, PLANT, { op: 'setGroup', keys: ['5003', '5004'], group: 'Corner Stores' }, now);
  assert.equal(many.changed, 2); assert.match(many.message, /^2 customers are in Corner Stores now/);
  assert.ok((await S.salesRows(db, PLANT)).rows.some(r => r.account === '5001' && r.group === 'Corner Stores'), 'the Sales app gets the group');
  // Renaming follows on every customer in it; removing takes it off them.
  out = await S.udclCall(db, boss, PLANT, { op: 'saveGroups', rename: { from: 'Corner Stores', to: 'Corner Shops' } }, now);
  assert.match(out.message, /3 customers moved to Corner Shops/);
  assert.deepEqual(out.groups, [{ name: 'Best Foods', customers: 0 }, { name: 'Corner Shops', customers: 3 }]);
  assert.equal(db.docs.get('udclCustomers/' + PLANT + '__5004').group, 'Corner Shops');
  await assert.rejects(S.udclCall(db, boss, PLANT, { op: 'saveGroups', rename: { from: 'Best Foods', to: 'corner shops' } }, now), /already a group/);
  out = await S.udclCall(db, boss, PLANT, { op: 'saveGroups', remove: 'Corner Shops' }, now);
  assert.deepEqual(out.groups, [{ name: 'Best Foods', customers: 0 }]);
  assert.equal(db.docs.get('udclCustomers/' + PLANT + '__5001').group, '');
  const empty = await S.udclCall(db, mgr, PLANT, { op: 'setGroup', keys: ['5002'], group: '' }, now);
  assert.match(empty.message, /has no group now/);
});

test('Joe 11/3: a new account number moves the customer to its new key, with its route day stops', async () => {
  const { db } = await imported();
  await assert.rejects(S.udclCall(db, disp, PLANT, { op: 'changeAccount', key: '5001', account: '6001' }, now), /Administrator or Manager/);
  await assert.rejects(S.udclCall(db, mgr, PLANT, { op: 'changeAccount', key: '5001', account: '5002' }, now), /already BEST FOODS #2/);
  const out = await S.udclCall(db, mgr, PLANT, { op: 'changeAccount', key: '5001', account: '6001' }, now);
  assert.equal(out.oldKey, '5001'); assert.equal(out.customer.key, '6001'); assert.equal(out.customer.account, '6001'); assert.equal(out.customer.name, 'ACME MARKET');
  assert.equal(out.routeDays.length, 2); assert.match(out.message, /has account 6001 now, on route 900/);
  assert.equal(db.docs.has('udclCustomers/' + PLANT + '__5001'), false);
  const v = await S.udclCall(db, mgr, PLANT, { op: 'view' });
  assert.ok(v.customers['6001']);
  assert.ok(v.routeDays.filter(rd => rd.stops.some(s => s.key === '6001' && s.account === '6001')).length === 2, 'its stops follow');
  assert.ok(v.routeDays.every(rd => rd.stops.every(s => s.key !== '5001')));
  assert.ok((await S.salesRows(db, PLANT)).rows.some(r => r.account === '6001'), 'the Sales app gets the new number');
  // The same key (only the way it is written changes) just saves the number.
  const same = await S.udclCall(db, mgr, PLANT, { op: 'changeAccount', key: '6001', account: '6001.0' }, now);
  assert.equal(same.customer.key, '6001'); assert.deepEqual(same.routeDays, []);
});

test('who may change what follows the United Dairy Hub (Joe 11-4-26): role standard, saved templates, Allow and Deny', () => {
  const { rightsOf } = require('../../src/udcl');
  const none = { templates: {}, meta: {}, exceptions: {} };
  const mgr = { status: 'ACTIVE', roles: ['Manager'] }, sup = { status: 'ACTIVE', roles: ['Supervisor'] }, adm = { status: 'ACTIVE', roles: ['Administrator'] };
  assert.deepEqual(rightsOf(mgr, none), { view: true, edit: true, importList: false }, 'a Manager edits by standard');
  assert.deepEqual(rightsOf(sup, none), { view: true, edit: false, importList: false });
  assert.deepEqual(rightsOf(adm, none), { view: true, edit: true, importList: true });
  assert.equal(rightsOf(sup, Object.assign({}, none, { exceptions: { grants: ['customers.edit', 'customers.import'] } })).importList, true, 'Allow for one person');
  assert.equal(rightsOf(mgr, Object.assign({}, none, { exceptions: { denials: ['customers.edit'] } })).edit, false, 'Deny for one person');
  assert.equal(rightsOf(mgr, { templates: { MANAGER: ['dashboard.read'] }, meta: { MANAGER: { updatedAt: '2026-10-20T00:00:00.000Z' } }, exceptions: {} }).edit, true, 'a template saved before the right keeps the standard');
  assert.equal(rightsOf(mgr, { templates: { MANAGER: ['dashboard.read'] }, meta: { MANAGER: { updatedAt: '2026-11-05T00:00:00.000Z' } }, exceptions: {} }).edit, false, 'a template saved after decides');
  assert.equal(rightsOf({ status: 'ACTIVE', roles: ['Sales'] }, { templates: { SALES: ['customers.edit'] }, meta: {}, exceptions: {} }).edit, true, 'a role ticked in Roles & Rights');
  assert.deepEqual(rightsOf({ status: 'INACTIVE', roles: ['Administrator'] }, none), { view: false, edit: false, importList: false });
});
