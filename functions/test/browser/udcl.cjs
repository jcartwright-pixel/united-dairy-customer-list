'use strict';
/*
 * Joe 11/1: the United Dairy Customer List. Customers (by customer, route and day; a customer's card), Route Book (move a stop,
 * change a load number), Truck Load Map (paint a spot, type a load sequence, move a line), Administration and the Load Map Kiosk, each with its Print menu. Made-up customers only.
 * Pictures at 1920, 1366 and 390 go to SHOTS_DIR.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { db, clear, localCalls } = require('../helpers.cjs');
const U = require('../../src/udcl-rules');
const S = require('../../src/udcl');

const HOSTING = process.argv[2] || 'http://127.0.0.1:5000';
const SDK = path.dirname(require.resolve('firebase/package.json'));
const SHOTS = process.env.SHOTS_DIR;
const EMAIL = 'cl.admin@uniteddairy.com', VIEWER = 'cl.viewer@uniteddairy.com', PLANT = 'fac_uniontown';
const MENU = [['DAY', 'ROUTE', 'Chain', 'Account', 'Name', null, null]].concat([
  ['TUE', 803, 0, 1196, 'ACORN CORNER MARKET', 4, 4], ['TUE', 803, 0, 40463, 'DQ HILLVIEW', 8, 8], ['TUE', 803, 415, 1526, 'KUHNS OAK HILL', 3, 3],
  ['TUE', 803, 0, 1984, 'QUICK STOP *COD*', 4, 4], ['TUE', 803, 0, 40221, 'DQ RIVERSIDE', 8, 8], ['FRI', 803, 0, 1196, 'ACORN CORNER MARKET', 5, 5],
  ['FRI', 803, 0, 40463, 'DQ HILLVIEW', 8, 8], ['THU', 805, 0, 13590, 'DQ BETHEL KNOLL', 6, 6], ['THU', 805, 411, 40121, 'A PLUS MAPLE #7517', 1, 1],
  ['THU', 805, 0, 1707, 'CASH N SAVE - COD', 2, 2], ['SAT', 805, 0, 13590, 'DQ BETHEL KNOLL', 7, 7], ['MON', 808, 990, 2603, 'WAL-MART #2603 MAPLETON', 10, 10]
]);
const today = U.DAYS[new Date().getDay()];

async function page(browser, email, size) {
  const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 950 } });
  await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z-]+\.js)$/, (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, r.request().url().split('/').pop())) }));
  await localCalls(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => { throw e; });
  p.emailFor = (url) => HOSTING + '/' + url + (url.includes('?') ? '&' : '?') + 'testEmail=' + email;
  return p;
}
const shot = async (p, name) => { if (!SHOTS) return; await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };

async function ph0(browser) {
  const ctx = await browser.newContext(), p = await ctx.newPage();
  const r = await p.request.get(HOSTING + '/manifest.webmanifest');
  assert.equal(r.status(), 200);
  const m = await r.json();
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.equal((await p.request.get(HOSTING + i.src)).status(), 200, i.src);
  assert.equal((await p.request.get(HOSTING + '/sw.js')).status(), 200);
  for (const f of fs.readdirSync(path.join(__dirname, '../../../public')).filter(x => x.endsWith('.html'))) assert.match(fs.readFileSync(path.join(__dirname, '../../../public', f), 'utf8'), /rel="manifest" href="manifest\.webmanifest"/, f);
  await ctx.close();
  return m;
}

(async () => {
  await clear();
  await db().collection('users').doc(EMAIL).set({ name: 'Test Admin', status: 'ACTIVE', roles: ['ADMIN'], facilities: ['*'], cells: { id: 'usr_cla', version: '1' } });
  await db().collection('users').doc(VIEWER).set({ name: 'Test Dispatcher', status: 'ACTIVE', roles: ['DISPATCHER'], facilities: [PLANT], cells: { id: 'usr_clv', version: '1' } });
  const m = U.menuStops(MENU);
  // The 805 Thursday made-up Route Book: run order, a key and instructions.
  const book = { '805|THU': { startTime: '2:30 AM', instructions: ['Call the DQ before 6 AM'], stops: [{ account: '40121', name: 'A PLUS MAPLE #7517', run: 1, keys: 'Ring 4' }, { account: '1707', name: 'CASH N SAVE - COD', run: 2 }, { account: '13590', name: 'DQ BETHEL KNOLL', run: 3 }], grid: [] } };
  await S.udclCall(db(), { email: EMAIL }, PLANT, { op: 'importMenu', stops: m.stops, unrouted: m.unrouted, addresses: { 1196: { address: '12 ELM ST', city: 'MAPLETON', state: 'PA', zip: '15401' } }, book, fileName: 'Made Up Route Menu.xlsb' });

  // CHROME_PATH: a Chromium already on the computer (a test machine without Playwright's own download).
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    // Customers: by customer, by route, by day; a card; the Print menu.
    const p = await page(browser, EMAIL);
    await p.goto(p.emailFor('customers.html'));
    await p.waitForSelector('#rows tr[data-key="1196"]');
    assert.equal(await p.textContent('#count'), '9 customers');
    // Joe 11/3: this screen is Routes. Chain, Account, Customer, DC, then Sun..Sat holding that day's route (no address, no group).
    assert.equal(await p.textContent('.head h1'), 'Routes');
    assert.deepEqual(await p.$$eval('#thead th', x => x.map(t => t.textContent)), ['Chain', 'Account', 'Customer', 'DC', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    assert.deepEqual(await p.$$eval('#rows tr[data-key="1196"] td', x => x.slice(1).map(t => t.textContent)), ['1196', 'ACORN CORNER MARKET', 'Uniontown', '', '', '803', '', '', '803', '']);
    await shot(p, 'udcl-1920-customers');
    await p.click('#views [data-view="route"]');
    await p.selectOption('#route', '805');
    assert.equal(await p.textContent('#count'), '4 deliveries');
    assert.match(await p.textContent('#rows tr.group'), /Route 805 · Thursday/);
    await shot(p, 'udcl-1920-by-route');
    await p.click('#views [data-view="day"]');
    await p.selectOption('#route', '');
    await p.selectOption('#day', 'TUE');
    assert.equal(await p.textContent('#count'), '5 deliveries');
    // Joe 11/2: the Directory tab: no routes, with GPS and phone.
    await p.selectOption('#day', '');
    await p.click('#views [data-view="list"]');
    assert.equal(await p.isHidden('#day'), true, 'no Day box on the Directory');
    assert.deepEqual(await p.$$eval('#thead th', x => x.map(t => t.textContent)), ['DC', 'Chain', 'Account', 'Customer', 'Address', 'GPS', 'Phone', 'Address check']);
    assert.equal(await p.textContent('#count'), '9 customers');
    assert.match(await p.textContent('#rows tr[data-key="1196"]'), /Uniontown.*1196.*12 ELM ST, MAPLETON, PA 15401/);
    await shot(p, 'udcl-1920-directory');
    // Joe 11/2: the master customer list (its own tab, Customers, since 11/3): Status first, the master file's headings, its upload, the sorts, and Inactive.
    const m = await page(browser, EMAIL);
    await m.goto(m.emailFor('master-customers.html'));
    await m.waitForSelector('#rows tr[data-key="1196"]');
    assert.equal(await m.textContent('#udcl-nav a[aria-current="page"]'), 'Customers');
    assert.deepEqual(await m.$$eval('#thead th', x => x.map(t => t.textContent.trim())), ['', 'Status', 'DC ▲', 'Route', 'Group', 'Chain', 'Account', 'Customer', 'Street', 'Second line', 'City', 'State', 'ZIP', 'Latitude', 'Longitude', 'Phone', 'Match status', 'Coordinate source']);
    assert.match(await m.textContent('#card-stats'), /9\s*customers/);
    // Joe 11/3: the upload sits in its own box, so the list keeps the screen.
    assert.equal(await m.isHidden('#upload-box'), true);
    await m.click('#upload-open');
    await m.setInputFiles('#i-addr', { name: 'Made Up Master List.csv', mimeType: 'text/csv', buffer: Buffer.from('DC,Chain,Account,Customer,Street,City,State,Zip,Latitude,Longitude,Phone,Group\n30,0,1196,ACORN CORNER MARKET,12 ELM ST,MAPLETON,PA,15401,39.9,-79.7,555-0199,Corner Stores\n30,0,7001,BIRCH STREET DELI,4 BIRCH ST,MAPLETON,PA,15401,,,,\n30,0,7002,CEDAR MINI MART,9 CEDAR ST,MAPLETON,PA,15401,,,,\n30,0,7003,...OLD PINE MARKET,1 PINE ST,MAPLETON,PA,15401,,,,\n') });
    // The Excel reader comes from the internet; a test machine stands in a small CSV reader for it.
    await m.evaluate(() => { if (!window.XLSX) window.XLSX = { read: (buf) => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: new TextDecoder().decode(buf) } }), utils: { sheet_to_json: (t) => t.trim().split('\n').map(l => l.split(',')) } }; });
    await m.click('#i-addr-go');
    await m.waitForSelector('#i-msg .good, #i-msg .bad', { timeout: 60000 });
    assert.ok(await m.$('#i-msg .good'), await m.textContent('#i-msg'));
    // Joe 11/3: a name that starts with "..." comes in inactive.
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__7003').get()).data().inactive, true);
    const acorn = (await db().collection('udclCustomers').doc('fac_uniontown__1196').get()).data();
    assert.equal(acorn.phone, '555-0199'); assert.equal(acorn.address2, ''); assert.equal(acorn.group, 'Corner Stores'); assert.equal(acorn.lat, 39.9);
    await m.click('#upload-close');
    assert.equal(await m.isHidden('#upload-box'), true);
    assert.match(await m.textContent('#card-last'), /Last master list: Made Up Master List\.csv/);
    assert.match(await m.textContent('#rows tr[data-key="1196"]'), /39\.900000.*-79\.700000.*555-0199/);
    // Sorts: Customer name; a heading pressed twice goes the other way.
    await m.selectOption('#sort', 'name');
    assert.equal(await m.getAttribute('#rows tr[data-key]:first-child', 'data-key'), '7003', 'a name starting with dots sorts first');
    await m.click('#thead button[data-col="5"]'); await m.click('#thead button[data-col="5"]');
    assert.equal(await m.getAttribute('#thead button[data-col="5"]', 'aria-sort'), 'descending');
    assert.equal(await m.getAttribute('#rows tr[data-key]:first-child', 'data-key'), '40463');
    // Joe 11/3: double-click a status to switch it. It asks first (the customer is on route 808 Monday), then it is off the route.
    m.once('dialog', d => d.accept());
    await m.dblclick('#rows button.st[data-key="2603"]');
    await m.waitForFunction(() => /inactive/.test(document.getElementById('save-msg').textContent));
    assert.match(await m.textContent('#save-msg'), /taken off route 808 Monday/);
    assert.equal(await m.textContent('#rows button.st[data-key="2603"]'), 'Inactive');
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__2603').get()).data().inactive, true);
    // Pick a run of rows (click, then Shift-click) and make them inactive together, then active again.
    // Pick rows: a click picks one, Shift-click picks the run between, Clear lets go.
    const shownKeys = await m.$$eval('#rows tr[data-key]', x => x.map(r => r.dataset.key));
    assert.equal(await m.isHidden('#picked'), true);
    await m.click('#rows tr[data-key="' + shownKeys[0] + '"] td:nth-child(8)');
    await m.click('#rows tr[data-key="' + shownKeys[3] + '"] td:nth-child(8)', { modifiers: ['Shift'] });
    assert.equal(await m.textContent('#picked-n'), '4 picked');
    await m.click('#pick-clear');
    assert.equal(await m.isHidden('#picked'), true);
    // Two customers on no route, picked one click each, made inactive together and then active again.
    const onRoute = new Set((await db().collection('udclRouteDays').get()).docs.flatMap(d => (d.data().stops || []).map(s => s.key)));
    const keys = ['7001', '7002'].filter(k => !onRoute.has(k) && shownKeys.includes(k));
    assert.equal(keys.length, 2, 'two customers on no route');
    const pickBoth = async () => { for (const k of keys) await m.click('#rows tr[data-key="' + k + '"] td:nth-child(8)'); assert.equal(await m.textContent('#picked-n'), '2 picked'); };
    await pickBoth();
    await m.click('#pick-off');
    await m.waitForFunction(() => /2 customers are inactive now/.test(document.getElementById('save-msg').textContent));
    for (const k of keys) assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__' + k).get()).data().inactive, true, k);
    assert.equal(await m.isHidden('#picked'), true, 'the picked rows let go after the change');
    await pickBoth();
    await m.click('#pick-on');
    await m.waitForFunction(() => /2 customers are active now/.test(document.getElementById('save-msg').textContent));
    for (const k of keys) assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__' + k).get()).data().inactive, undefined, k);
    // Joe 11/3: groups are added on Administration and set on Customers (one, or every picked line), and a rename follows.
    const g = await page(browser, EMAIL);
    await g.goto(g.emailFor('administration.html'));
    await g.waitForSelector('#g-rows tr[data-name="Corner Stores"]');
    await g.fill('#g-new', "Kuhn's Market"); await g.press('#g-new', 'Enter');
    await g.waitForSelector('#g-rows tr[data-name="Kuhn\'s Market"]');
    assert.match(await g.textContent('#g-msg'), /was added/);
    await m.reload(); await m.waitForSelector('#rows tr[data-key="1526"]');
    await m.click('#rows button.grp[data-key="1526"]');
    await m.selectOption('#rows select.grp-pick', "Kuhn's Market");
    await m.waitForFunction(() => /is in Kuhn's Market now/.test(document.getElementById('save-msg').textContent));
    assert.equal(await m.textContent('#rows button.grp[data-key="1526"]'), "Kuhn's Market");
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__1526').get()).data().group, "Kuhn's Market");
    await pickBoth();
    await m.selectOption('#pick-group', 'Corner Stores');
    await m.waitForFunction(() => /2 customers are in Corner Stores now/.test(document.getElementById('save-msg').textContent));
    for (const k of keys) assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__' + k).get()).data().group, 'Corner Stores', k);
    await g.click('#g-rows tr[data-name="Kuhn\'s Market"] button[data-act="rename"]');
    await g.fill('#g-rows input.g-name', 'Kuhn Markets'); await g.press('#g-rows input.g-name', 'Enter');
    await g.waitForSelector('#g-rows tr[data-name="Kuhn Markets"]');
    assert.match(await g.textContent('#g-msg'), /1 customer moved to Kuhn Markets/);
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__1526').get()).data().group, 'Kuhn Markets');
    await shot(g, 'udcl-1920-groups');
    await g.close();
    // Joe 11/3: a new group from the group box itself.
    await m.click('#rows button.grp[data-key="1196"]');
    await m.selectOption('#rows select.grp-pick', '+');
    await m.fill('#rows input.grp-new', 'Honey Bear'); await m.press('#rows input.grp-new', 'Enter');
    await m.waitForFunction(() => /is in Honey Bear now/.test(document.getElementById('save-msg').textContent));
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__1196').get()).data().group, 'Honey Bear');
    assert.ok((await db().collection('private').doc('udcl_fac_uniontown').get()).data().groups.includes('Honey Bear'));
    // Joe 11/3: the view stays as it was left.
    await m.selectOption('#status', 'Active');
    await m.click('#thead button[data-col="6"]');
    await m.reload(); await m.waitForSelector('#rows tr[data-key]');
    assert.equal(await m.inputValue('#status'), 'Active');
    assert.equal(await m.getAttribute('#thead button[data-col="6"]', 'aria-sort'), 'ascending');
    await m.selectOption('#status', '');
    // Joe 11/3: edit the customer, its account number too: double-click its line for the card.
    await m.dblclick('#rows tr[data-key="7001"] td:nth-child(8)');
    await m.waitForSelector('#panel #c-account');
    await m.fill('#c-account', '7101'); await m.press('#c-account', 'Tab');
    await m.waitForSelector('#c-msg .good');
    assert.match(await m.textContent('#c-msg'), /has account 7101 now/);
    assert.ok(await m.$('#rows tr[data-key="7101"]'), 'the line has its new number');
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__7001').get()).exists, false);
    await m.fill('#c-name', 'BIRCH STREET DELI & GROCERY'); await m.press('#c-name', 'Tab');
    await m.waitForFunction(() => document.querySelector('#rows tr[data-key="7101"]').textContent.includes('BIRCH STREET DELI & GROCERY'));
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__7101').get()).data().name, 'BIRCH STREET DELI & GROCERY');
    await shot(m, 'udcl-1920-customer-edit');
    await m.click('#p-close');
    await shot(m, 'udcl-1920-master-customers');
    await p.reload();
    await p.waitForSelector('#rows tr[data-key="1196"]');
    assert.equal(await p.$('#rows tr[data-key="2603"]'), null, 'an inactive customer is not on Routes');
    assert.match(await p.textContent('#imported'), /Master list: Made Up Master List\.csv/);
    await p.click('#views [data-view="day"]');
    await p.selectOption('#day', 'TUE');
    await p.click('#rows tr[data-key="40463"]');
    await p.waitForSelector('#panel');
    await p.fill('#c-phone', '555-0100');
    await p.press('#c-phone', 'Tab');
    await p.waitForSelector('#c-msg .good');
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__40463').get()).data().phone, '555-0100');
    await shot(p, 'udcl-1920-customer-card');
    await p.click('#p-close');
    await p.click('#udcl-print-menu > button');
    const items = await p.$$eval('#udcl-print-menu .pm-list button', b => b.map(x => x.childNodes[0].textContent));
    assert.deepEqual(items, ['This list, as shown', 'Route sequence sheets for the office', 'Driver route book pages', 'Customer list by route', 'Customer list by day', 'Customer addresses and phones']);
    await shot(p, 'udcl-1920-print-menu');
    await p.click('#udcl-print-menu .pm-list button[data-i="2"]');
    const frame = await (await p.waitForSelector('#udcl-print', { state: 'attached' })).contentFrame();
    await frame.waitForSelector('.lm-truck');
    assert.match(await frame.textContent('body'), /Route 803 · Tuesday/);

    // Route Book: 805 Thursday has the Route Book's run order, start time and instructions; move a stop, change a load.
    const s = await page(browser, EMAIL, { width: 1366, height: 650 });
    await s.goto(s.emailFor('route-sequence.html?route=805&day=THU'));
    await s.waitForSelector('#rows tr[data-drag]');
    // Joe 11/2: the screen is called Route Book; Chain before Account; the customer's name only (no city).
    assert.equal(await s.textContent('h1'), 'Route Book');
    assert.deepEqual((await s.$$eval('#rows thead th, table thead th', x => x.map(t => t.textContent))).slice(0, 5), ['Run Seq', 'Load Seq', 'Chain', 'Account', 'Customer']);
    assert.equal(await s.textContent('#rows tr[data-drag="40121"] td:nth-child(3)'), '411');
    assert.equal(await s.textContent('#rows tr[data-drag="40121"] td:nth-child(5)'), 'A PLUS MAPLE #7517');
    assert.deepEqual(await s.$$eval('#rows tr[data-drag]', r => r.map(x => x.dataset.drag)), ['40121', '1707', '13590']);
    assert.equal(await s.inputValue('#start'), '2:30 AM');
    assert.equal(await s.inputValue('#notes'), 'Call the DQ before 6 AM');
    await shot(s, 'udcl-1366-sequence');
    await s.click('#rows button[data-down="0"]');
    await s.waitForFunction(() => document.querySelector('#rows tr[data-drag]').dataset.drag === '1707');
    const ref = db().collection('udclRouteDays').doc('fac_uniontown__805__THU');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[0].key !== '1707'; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual((await ref.get()).data().stops.map(x => x.key), ['1707', '40121', '13590']);
    await s.fill('#rows input.seq[data-i="2"]', '9');
    await s.press('#rows input.seq[data-i="2"]', 'Tab');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[2].loadSeq !== 9; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await ref.get()).data().stops[2].loadSeq, 9);
    for (let i = 0; i < 50 && U.cleanMap((await ref.get()).data().map).cells.flat().includes(6); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(U.cleanMap((await ref.get()).data().map).cells.flat().includes(6), false, 'the truck\'s 6 spots became 9');
    await s.click('#udcl-print-menu > button');
    assert.equal(await s.textContent('#udcl-print-menu .pm-list button[data-i="0"]'), 'Route 805 Thursday for the officeStops in order with load sequence, address and notes');

    // A dispatcher sees and prints but cannot change.
    const v = await page(browser, VIEWER, { width: 1366, height: 650 });
    await v.goto(v.emailFor('route-sequence.html?route=805&day=THU'));
    await v.waitForSelector('#rows tr[data-drag]');
    assert.equal(await v.$$eval('#rows input', x => x.length), 0);
    assert.match(await v.textContent('#hint'), /Only an Administrator or Manager/);

    // Truck Load Map: paint a spot with load 9.
    const l = await page(browser, EMAIL);
    await l.goto(l.emailFor('load-map.html?route=805&day=THU'));
    await l.waitForSelector('.lm-cell.edit');
    await l.click('#brush button[data-seq="9"]');
    await l.click('.lm-cell[data-r="0"][data-c="0"]');
    const spot = async () => U.cleanMap((await ref.get()).data().map).cells[0][0];
    for (let i = 0; i < 60 && (await spot()) !== 9; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(await spot(), 9);
    await l.selectOption('#door', '6');
    await l.waitForSelector('.lm-door');
    // Joe 11/1: the Run Seq and Load Seq columns; type a load sequence (the truck's spots follow), move a line (the run order).
    assert.match(await l.textContent('.lm-right thead'), /Run Seq\s*Load Seq/);
    for (let i = 0; i < 50 && U.cleanMap((await ref.get()).data().map).door !== 6; i++) await new Promise(r => setTimeout(r, 100));
    const had2 = U.cleanMap((await ref.get()).data().map).cells.flat().filter(v => v === 2).length;
    assert.ok(had2 > 0, 'load 2 has spots on the truck');
    await l.fill('#rows input.lm-seq[data-i="0"]', '5');
    await l.press('#rows input.lm-seq[data-i="0"]', 'Tab');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[0].loadSeq !== 5; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await ref.get()).data().stops[0].loadSeq, 5);
    const cells = U.cleanMap((await ref.get()).data().map).cells.flat();
    assert.equal(cells.filter(v => v === 2).length, 0);
    assert.equal(cells.filter(v => v === 5).length, had2, 'the spots that had load 2 now have 5');
    await l.focus('#rows tr[data-drag="13590"]');
    await l.keyboard.press('Alt+ArrowUp');
    for (let i = 0; i < 50 && (await ref.get()).data().stops[1].key !== '13590'; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual((await ref.get()).data().stops.map(x => x.key), ['1707', '13590', '40121']);
    await l.waitForFunction(() => [...document.querySelectorAll('#rows tr[data-drag]')].map(r => r.dataset.drag).join() === '1707,13590,40121');
    await shot(l, 'udcl-1920-load-map');
    // The kiosk is not in the menu; Administration is, for an administrator.
    const nav = await l.$$eval('#udcl-nav a', a => a.filter(x => x.offsetParent).map(x => x.textContent));
    assert.deepEqual(nav, ['Home', 'Customers', 'Routes', 'Route Book', 'Truck Load Map', 'Administration']);
    assert.equal(await v.$$eval('#udcl-nav a', a => a.filter(x => x.offsetParent).map(x => x.textContent).includes('Administration')), false, 'a dispatcher has no Administration');

    // Administration: the view-only link to the kiosk.
    const ad = await page(browser, EMAIL);
    await ad.goto(ad.emailFor('administration.html'));
    await ad.waitForSelector('#imported:not(:empty)');
    assert.match(await ad.textContent('#imported'), /Made Up Route Menu\.xlsb/);
    assert.equal(await ad.getAttribute('#kiosk-link', 'href'), 'load-map.html?kiosk=1');
    await shot(ad, 'udcl-1920-administration');

    // The kiosk: today's routes as buttons, the truck and its customers, nothing to change.
    const k = await page(browser, EMAIL, { width: 1920, height: 1080 });
    await k.goto(k.emailFor('load-map.html?kiosk=1&day=THU'));
    await k.waitForSelector('#kiosk-routes button[data-route="805"]');
    assert.equal(await k.$$eval('.lm-cell.edit', x => x.length), 0);
    assert.equal(await k.isHidden('#editor'), true);
    assert.match(await k.textContent('#rows'), /CASH N SAVE/);
    assert.equal(await k.$$eval('#rows input', x => x.length), 0, 'the kiosk has no boxes');
    assert.equal(await k.$$eval('#rows tr[data-drag]', x => x.length), 0, 'and no lines to drag');
    assert.equal(await k.isVisible('#go-admin'), true, 'the kiosk has an Administration button');
    assert.equal(await k.$$eval('#udcl-nav', x => x.length), 0, 'and no menu');
    await shot(k, 'udcl-1920-kiosk');

    // Joe 11/2: a new version published shows the yellow "Update ready" banner with Refresh.
    const vfile = path.join(__dirname, '..', '..', '..', 'public', 'version.json');
    fs.writeFileSync(vfile, JSON.stringify({ commit: 'aaa111' }));
    const u = await page(browser, EMAIL);
    await u.goto(u.emailFor('customers.html?updatetest=1'));
    await u.waitForSelector('#rows tr[data-key]');
    await u.waitForTimeout(500);
    assert.equal(await u.$$eval('#update-ready', x => x.length), 0, 'no banner while the version is the same');
    fs.writeFileSync(vfile, JSON.stringify({ commit: 'bbb222' }));
    await u.evaluate(() => window.UDCL_checkForUpdate());
    await u.waitForSelector('#update-ready');
    assert.match(await u.textContent('#update-ready'), /Update ready\. A new version of the Customer List is out/);
    await shot(u, 'udcl-1920-update-ready');
    fs.unlinkSync(vfile);

    // Joe 11/2: Route Book's Edit box moves a stop to another route; the Load Map window, opened from it, changes it live.
    const q = await page(browser, EMAIL);
    await q.goto(q.emailFor('route-sequence.html?route=803&day=TUE'));
    await q.waitForSelector('#rows tr[data-drag="1526"]');
    assert.equal(await q.$$eval('#rows button.rm', x => x.length), 0, 'no Remove button any more');
    const at = await q.$$eval('#rows tr[data-drag]', r => r.findIndex(x => x.dataset.drag === '1526'));
    await q.click('#rows button[data-ed="' + at + '"]');
    await q.waitForSelector('#edit .ed-days input');
    assert.deepEqual(await q.$$eval('#ed-days input:checked', x => x.map(i => i.value)), ['TUE']);
    // Days on route 803: tick Wednesday, the box says so (not saved: the move below is what this test does).
    await q.check('#ed-days input[value="WED"]');
    assert.match(await q.textContent('#ed-what'), /Goes on route 803 on Wednesday/);
    await q.uncheck('#ed-days input[value="WED"]');
    // Move to another route: Tuesday (the day shown) is ticked; pick 805.
    assert.deepEqual(await q.$$eval('#mv-days input:checked', x => x.map(i => i.value)), ['TUE']);
    assert.equal(await q.isDisabled('#mv-go'), true);
    await q.selectOption('#mv-route', '805');
    assert.match(await q.textContent('#mv-what'), /Comes off route 803 and goes on route 805 on Tuesday\./);
    assert.equal(await q.textContent('#mv-go'), 'Move to route 805');
    await q.fill('#ed-cnotes', 'Back door after 6');
    await shot(q, 'udcl-1920-edit-stop');
    await q.click('#mv-go');
    await q.waitForSelector('#edit', { state: 'detached' });
    await q.waitForFunction(() => !document.querySelector('#rows tr[data-drag="1526"]'));
    const tue803 = (await db().collection('udclRouteDays').doc('fac_uniontown__803__TUE').get()).data().stops.map(x => x.key);
    assert.equal(tue803.includes('1526'), false);
    assert.ok((await db().collection('udclRouteDays').doc('fac_uniontown__805__TUE').get()).data().stops.some(x => x.key === '1526'));
    assert.equal((await db().collection('udclCustomers').doc('fac_uniontown__1526').get()).data().notes, 'Back door after 6');
    const [win] = await Promise.all([q.waitForEvent('popup'), q.click('#open-map')]);
    await win.waitForSelector('#rows input.lm-seq');
    assert.equal(await win.isVisible('#udcl-nav'), false, 'the Load Map window has no menu');
    assert.match(await win.textContent('#title'), /Route 803 · Tuesday/);
    const first = await win.$eval('#rows tr[data-drag]', r => r.dataset.drag);
    await win.fill('#rows input.lm-seq[data-i="0"]', '12');
    await win.press('#rows input.lm-seq[data-i="0"]', 'Tab');
    await q.waitForFunction((k) => { const r = document.querySelector('#rows tr[data-drag="' + k + '"] input.seq'); return r && r.value === '12'; }, first, { timeout: 10000 });
    await shot(win, 'udcl-load-map-window');

    // Joe 11/1: "want to downloadable app": every page names the app's manifest, and its icons are there.
    await ph0(browser);
    // A phone width.
    const ph = await page(browser, EMAIL, { width: 390, height: 844 });
    await ph.goto(ph.emailFor('customers.html'));
    await ph.waitForSelector('#rows tr[data-key]');
    await shot(ph, 'udcl-390-customers');
    void today;
    console.log('udcl: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
