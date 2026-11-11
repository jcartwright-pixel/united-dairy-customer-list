// Routes (United Dairy Customer List, Joe 11/1; named Routes on 11/3, the master list is Customers now): every customer by customer, by route or by day, with the boxes to find,
// filter and sort, a customer's own card (address, phone, keys or door code, notes) and the Print menu. An Administrator imports the
// Route Menu workbook here (and the Route Book with it), or brings over the Sales app's list.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { openCard, panel } from './udcl-card.js';
import { readList, saveStep, savedView, saveView, printMenu, printDoc, tablePage, routeDayPage, sortedRouteDays, routesOf, announceChange, U } from './udcl.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const el = document.createElement('script'); el.src = XLSX_URL; el.onload = () => ok(window.XLSX); el.onerror = () => bad(new Error('Could not load the Excel reader. Check the network and try again.')); document.head.appendChild(el); });

const params = new URLSearchParams(location.search);
// Joe 11/2: the Customer Address List became the master list (the Customers tab since 11/3).
if (params.get('view') === 'master') location.replace('master-customers.html');
// Joe 11/3: the screen opens the way it was left (the tab and the boxes), unless the link says otherwise.
const VIEWS = ['customer', 'route', 'day', 'list'], BOXES = ['route', 'day', 'dcpick', 'chain', 'sort'];
let saved = savedView('routes');
let data = null, view = VIEWS.includes(params.get('view')) ? params.get('view') : VIEWS.includes(saved.view) ? saved.view : 'customer';
const remember = () => { const v = { view }; BOXES.forEach(id => { v[id] = $(id).value; }); saveView('routes', v); };
// Worked out once each time the list changes (rebuild), not at every click: the lines, and one row per customer with its deliveries
// and the text Find looks in.
let allLines = [], allCustomers = [];
const $ = (id) => document.getElementById(id);
const f = () => ({ q: $('q').value, route: $('route').value, day: $('day').value, chain: $('chain').value, dc: $('dcpick').value, sort: $('sort').value || view });
const dayName = (d) => U.DAY_NAMES[d] || d;

function fillPickers() {
  const keep = (id, opts, all) => { const box = $(id), was = box.value; box.innerHTML = '<option value="">' + all + '</option>' + opts.map(([v, t]) => '<option value="' + e(v) + '">' + e(t) + '</option>').join(''); box.value = opts.some(o => o[0] === was) ? was : ''; };
  keep('route', routesOf(data.routeDays).map(r => [r, 'Route ' + r]), 'All routes');
  $('route-list').innerHTML = routesOf(data.routeDays).map(r => '<option value="' + e(r) + '">').join('');
  keep('day', U.DAYS.map(d => [d, dayName(d)]), 'All days');
  const chains = [...new Set(Object.values(data.customers).map(c => c.chain).filter(Boolean))].sort(U.byRoute);
  keep('chain', chains.map(c => [c, 'Chain ' + c]), 'All chains');
  const dcs = [...new Set(Object.values(data.customers).map(c => U.branchOf(c.dc)).filter(Boolean))].sort(U.byRoute);
  keep('dcpick', dcs.map(d => [d, dcPlain(d)]), 'All DCs');
  // The first time the boxes are filled, they take the remembered view (a link's route wins).
  if (saved) { BOXES.forEach(id => { if (saved[id] && [...$(id).options].some(o => o.value === saved[id])) $(id).value = saved[id]; }); saved = null; }
  if (params.get('route') && !$('route').value) $('route').value = params.get('route');
}

/** The customers picked by the boxes, one row each (a customer with no delivery shows only when no route or day is picked). */
function customersShown() {
  const fl = f(), lines = U.pick(allLines, Object.assign({}, fl, { sort: 'customer' }));
  const keys = new Set(lines.map(l => l.key));
  const words = U.text(fl.q).toUpperCase().split(' ').filter(Boolean);
  const rows = allCustomers.filter(c => (keys.has(c.key) || (!fl.route && !fl.day && (!fl.chain || c.chain === fl.chain) && !c.deliveries.length &&
    words.every(w => c.findText.indexOf(w) >= 0))) && (!fl.dc || U.branchOf(c.dc) === fl.dc));
  const s = fl.sort === 'customer' || !U.SORTS[fl.sort] ? null : fl.sort;
  if (s === 'account') rows.sort((a, b) => U.byRoute(a.account, b.account));
  else if (s === 'city') rows.sort((a, b) => U.byName(a.city, b.city) || U.byName(a.name, b.name));
  else if (s === 'chain') rows.sort((a, b) => U.byRoute(a.chain || 'zz', b.chain || 'zz') || U.byName(a.name, b.name));
  else if (s === 'route' || s === 'day') rows.sort((a, b) => { const x = (a.deliveries || [])[0] || {}, y = (b.deliveries || [])[0] || {}; return s === 'route' ? U.byRoute(x.route || 'zz', y.route || 'zz') || U.dayIndex(x.day) - U.dayIndex(y.day) : U.dayIndex(x.day) - U.dayIndex(y.day) || U.byRoute(x.route || 'zz', y.route || 'zz'); });
  return rows;
}
// Joe 11/2: the By Customer list shows Chain, Account, Customer, DC (its name only), then a column per day (Sun to Sat)
// holding the route that delivers that day, with no stop number.
const routesOn = (c, day) => [...new Set((c.deliveries || []).filter(d => d.day === day).map(d => d.route))].join(', ');
const dcPlain = (v) => U.dcName(v).replace(/^\d+\s+/, '');
/** By Customer: one line per customer and route it is on (a customer on no route gets one line with an empty route box). The Route
 * and Day boxes leave out the routes that do not match them. */
function routeRows(rows, fl) {
  const out = [];
  rows.forEach(c => {
    const ds = c.deliveries || [];
    const routes = [...new Set(ds.map(d => d.route))].sort(U.byRoute).filter(r => (!fl.route || r === fl.route) && (!fl.day || ds.some(d => d.route === r && d.day === fl.day)));
    if (routes.length) routes.forEach(route => out.push({ c, route }));
    else if (!ds.length) out.push({ c, route: '' });
  });
  return out;
}
const daysOn = (c, route) => (c.deliveries || []).filter(d => d.route === route).map(d => d.day);
/** One By Customer line. Someone who can change the list types the route and ticks the days; each change saves by itself. */
function customerLine(c, route) {
  const on = daysOn(c, route), ed = data.canEdit, k = e(c.key), r = e(route);
  const routeCell = ed ? '<input class="rt" type="text" inputmode="numeric" list="route-list" maxlength="' + U.LIMITS.route + '" value="' + r + '" data-from="' + r + '" placeholder="Route" aria-label="Route for ' + e(c.name) + '">' : r;
  return '<tr class="pick' + (c.active === false ? ' inactive' : '') + '" data-key="' + k + '" data-route="' + r + '"><td>' + e(c.chain) + '</td><td>' + e(c.account) + '</td><td class="l" title="' + e(c.name) + '"><b>' + e(c.name) + '</b></td><td class="l">' + e(dcPlain(c.dc)) + '</td><td class="rtcell">' + routeCell + '</td>' +
    U.DAYS.map(d => '<td class="dayroute"><label class="tick"><input type="checkbox" value="' + d + '"' + (on.includes(d) ? ' checked' : '') + (ed ? '' : ' disabled') + ' aria-label="' + e(dayName(d)) + (route ? ' on route ' + r : '') + ' for ' + e(c.name) + '"></label></td>').join('') + '</tr>';
}
/**
 * Joe 11-10-26: a change on a By Customer line saves by itself (the Route Book's own step, placeStop). The days ticked on the line
 * are the days the customer is on that line's route afterwards; a new route number moves every ticked day to it. A new day goes in
 * by its load sequence, as on Route Book.
 */
async function saveLine(tr) {
  const key = tr.dataset.key, from = tr.dataset.route, box = tr.querySelector('input.rt'), route = U.numText(box ? box.value : from, U.LIMITS.route);
  const days = [...tr.querySelectorAll('input[type="checkbox"]')].filter(x => x.checked).map(x => x.value);
  const c = allCustomers.find(x => x.key === key), was = c ? daysOn(c, from) : [];
  if (!/^\d+$/.test(route)) {
    // A route is a number. Clearing the box does not take the customer off: unticking its days does.
    showError(from ? (route ? 'A route is a number, like 815.' : 'To take ' + (c ? c.name : 'this customer') + ' off route ' + from + ', untick its days.') : days.length ? 'Type the route number first, then tick the days.' : route ? 'A route is a number, like 815.' : '');
    if (box) box.value = from;
    if (!from) tr.querySelectorAll('input[type="checkbox"]').forEach(x => { x.checked = false; });
    return;
  }
  if (!from && !days.length) return;   // a route typed on a customer with none: it goes on once a day is ticked
  if (route === from && days.length === was.length && days.every(d => was.includes(d))) return;
  tr.querySelectorAll('input').forEach(x => { x.disabled = true; });
  tr.classList.add('saving');
  try {
    const out = await saveStep('placeStop', { key, from: from || route, route, day: was[0] || days[0], days, stay: [] });
    (out.changed || []).forEach(x => { const i = data.routeDays.findIndex(y => y.route === x.route && y.day === x.day); if (i >= 0) data.routeDays[i] = x; else data.routeDays.push(x); announceChange(x.route, x.day); });
    showError('');
  } catch (err) { showError(serverText(err, 'the customer list')); }
  rebuild();
}
// Only the first lines are drawn; "Show more" adds the next ones. Narrowing the boxes starts again from the top.
const PAGE = 300;
let shown = PAGE;
const page = (rows) => rows.slice(0, shown);
const moreRow = (rows, cols) => rows.length > shown ? '<tr class="more"><td colspan="' + cols + '">Showing ' + shown.toLocaleString() + ' of ' + rows.length.toLocaleString() +
  ' &nbsp; <button type="button" data-more="' + PAGE + '">Show ' + Math.min(PAGE, rows.length - shown) + ' more</button> <button type="button" data-more="all">Show all</button></td></tr>' : '';
// Joe 11/2: the Directory tab, "just ... the customer list with the addresses and the GPS coordinates ... and the phone numbers. Not the routes".
const gpsText = (c) => (c.lat && c.lon) ? Number(c.lat).toFixed(5) + ', ' + Number(c.lon).toFixed(5) : '';
const dirCols = [['DC', c => dcPlain(c.dc), 1], ['Chain', c => c.chain, 1], ['Account', c => c.account], ['Customer', c => c.name], ['Address', c => U.addressLine(c)], ['GPS', c => gpsText(c)], ['Phone', c => c.phone], ['Address check', c => c.addressCheck || '']];
const dayCols = U.DAYS.map(d => [dayName(d).slice(0, 3), c => routesOn(c, d), 1]);

function draw() {
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  ['route', 'day'].forEach(id => { $(id).closest('.field').hidden = view === 'list'; });
  if (!data) return;
  const fl = f();
  drawFooter();
  if (view === 'list') {
    const rows = customersShown();
    $('thead').innerHTML = '<tr><th style="width:7%">DC</th><th style="width:5%">Chain</th><th style="width:7%">Account</th><th class="l" style="width:20%">Customer</th><th class="l">Address</th><th style="width:11%">GPS</th><th class="l" style="width:9%">Phone</th><th class="l" style="width:10%">Address check</th></tr>';
    $('rows').innerHTML = page(rows).map(c => '<tr class="pick' + (c.active === false ? ' inactive' : '') + '" data-key="' + e(c.key) + '"><td>' + e(dcPlain(c.dc)) + '</td><td>' + e(c.chain) + '</td><td>' + e(c.account) + '</td><td class="l"><b>' + e(c.name) + '</b></td>' +
      '<td class="l" title="' + e(U.addressLine(c)) + '">' + (U.addressLine(c) ? e(U.addressLine(c)) : '<span class="warnline">No address yet</span>') + '</td>' +
      '<td>' + (gpsText(c) ? '<a href="https://www.google.com/maps?q=' + encodeURIComponent(c.lat + ',' + c.lon) + '" target="_blank" rel="noopener" title="Open in Google Maps">' + e(gpsText(c)) + '</a>' : '<span class="warnline">-</span>') + '</td><td class="l">' + e(c.phone) + '</td><td class="l" title="' + e([c.addressNote, c.addressProposed && ('Proposed: ' + c.addressProposed), c.gpsFrom && ('GPS from ' + c.gpsFrom)].filter(Boolean).join(' · ')) + '"><small>' + e(c.addressCheck || '') + '</small></td></tr>').join('') + moreRow(rows, 8) ||
      '<tr><td colspan="8" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
  } else if (view === 'customer') {
    const rows = customersShown(), lines = routeRows(rows, fl);
    // Joe 11/2: Chain, Account, Customer, DC, then the days. Joe 11-10-26: "be able to change the route ... tick the days that I
    // want", and fit the screen with no sideways scroll. One line per customer and route, the route in its own box and a tick
    // for each day it delivers.
    $('thead').innerHTML = '<tr><th style="width:5%">Chain</th><th style="width:7%">Account</th><th class="l">Customer</th><th class="l" style="width:10%">DC</th><th style="width:7.5%">Route</th>' +
      U.DAYS.map(d => '<th class="dayroute" style="width:5.5%">' + e(dayName(d).slice(0, 3)) + '</th>').join('') + '</tr>';
    $('rows').innerHTML = page(lines).map(r => customerLine(r.c, r.route)).join('') + moreRow(lines, 12) ||
      '<tr><td colspan="12" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
  } else {
    const lines = U.pick(allLines, fl);
    const grp = (l) => view === 'route' && (!$('sort').value || $('sort').value === 'route') ? 'Route ' + l.route + ' · ' + dayName(l.day) : view === 'day' && (!$('sort').value || $('sort').value === 'day') ? dayName(l.day) + ' · Route ' + l.route : '';
    // Joe 11-6-26: each customer's cases per delivery on that route day (from the Hub's weekly route report, read on Accounting Numbers), beside the run and
    // load sequence, and PALLET USES: the number Pallet Builder holds pallet space for (blank = the standard on Pallet Rules).
    const pr = data.palletRules || U.PALLET_RULES, std = 'Standard (' + U.CASE_RULE_NAMES[pr.standard] + ')';
    $('thead').innerHTML = '<tr><th style="width:5%">Day</th><th style="width:5%">Route</th><th style="width:5%">Run Seq</th><th style="width:5%">Load Seq</th><th style="width:7%">Account</th><th class="l" style="width:19%">Customer</th><th class="l" style="width:10%">City</th>' +
      '<th class="cs" style="width:5%">Low</th><th class="cs" style="width:5.5%">Middle</th><th class="cs" style="width:6%">Average</th><th class="cs" style="width:5%">High</th><th class="cs" style="width:6%" title="Average of the newest ' + pr.weeks + ' weeks">Last ' + pr.weeks + ' wks</th><th class="cs" style="width:11%">Pallet uses</th><th class="l">Stop note</th></tr>';
    let last = null;
    $('rows').innerHTML = lines.map(l => {
      const g = grp(l), head = g && g !== last ? '<tr class="group"><td colspan="14" class="l">' + e(g) + ' &nbsp; <a href="route-sequence.html?route=' + encodeURIComponent(l.route) + '&day=' + l.day + '">Open in Route Book &rarr;</a></td></tr>' : '';
      last = g;
      return head + '<tr class="pick" data-key="' + e(l.key) + '"><td>' + e(dayName(l.day).slice(0, 3)) + '</td><td>' + e(l.route) + '</td><td><span class="stopno">' + l.stop + '</span></td><td>' + (l.loadSeq || '<span class="warnline">-</span>') + '</td><td>' + e(l.account) + '</td><td class="l"><b>' + e(l.name) + '</b></td><td class="l">' + e(l.city) + '</td>' + caseCells(l, pr, std) + '<td class="l">' + e(l.note) + '</td></tr>';
    }).join('') || '<tr><td colspan="14" class="empty">' + (allLines.length ? 'No delivery matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = lines.length + ' deliver' + (lines.length === 1 ? 'y' : 'ies');
  }
}
// The case columns for one delivery line. A customer with no weeks yet shows a dash; the number PALLET USES picks is bold.
function caseCells(l, pr, std) {
  const st = U.caseStats(l.caseWeeks, pr.weeks);
  const rule = l.palletUses || pr.standard, on = (r) => r === rule ? ' class="cs held"' : ' class="cs"';
  const n = (v) => v == null ? '' : String(v);
  const cells = st ? '<td' + on('LOW') + '>' + n(st.low) + '</td><td' + on('MIDDLE') + '>' + n(st.middle) + '</td><td' + on('AVERAGE') + '>' + n(st.average) + '</td><td' + on('HIGH') + '>' + n(st.high) + '</td><td' + on('LAST') + '>' + n(st.last) + '</td>'
    : '<td class="cs none" colspan="5">No weeks yet</td>';
  const pick = data.canEdit
    ? '<select class="uses" data-route="' + e(l.route) + '" data-day="' + e(l.day) + '" data-key="' + e(l.key) + '" aria-label="Pallet uses for ' + e(l.name) + '"><option value="">' + e(std) + '</option>' +
      U.CASE_RULES.map(r => '<option value="' + r + '"' + (l.palletUses === r ? ' selected' : '') + '>' + e(r === 'LAST' ? 'Last ' + pr.weeks + ' weeks' : U.CASE_RULE_NAMES[r]) + '</option>').join('') + '</select>'
    : e(l.palletUses ? (l.palletUses === 'LAST' ? 'Last ' + pr.weeks + ' weeks' : U.CASE_RULE_NAMES[l.palletUses]) : std);
  return cells + '<td class="cs' + (l.palletUses ? ' own' : '') + '">' + pick + '</td>';
}
const lastUpload = (m) => m ? (m.fileName || 'a file') + ', ' + shortDate(m.at) + ' by ' + m.by : '';
function drawFooter() {
  const im = data.imported, ms = data.master;
  $('imported').innerHTML = [im && '<span><b>Route Menu:</b> ' + e(lastUpload(im)) + ' · ' + (im.counts.customers || 0) + ' customers, ' + (im.counts.routeDays || 0) + ' route days' +
    (im.counts.noLoadSeq ? ' · <span class="warnline">' + im.counts.noLoadSeq + ' stops have no load sequence yet</span>' : '') + '</span>',
    ms && '<span><b>Master list:</b> ' + e(lastUpload(ms)) + '</span>',
    casesLine()].filter(Boolean).join('');
}
// Joe 11-6-26: where the case numbers come from, and how many weeks there are.
function casesLine() {
  const n = (data.routeDays || []).reduce((a, rd) => Math.max(a, rd.caseWeeks || 0), 0);
  if (view === 'customer' || view === 'list') return '';
  return n ? '<span><b>Cases:</b> cases per delivery from ' + n + ' week' + (n === 1 ? '' : 's') + ' of the weekly route report (United Dairy Hub, Accounting Numbers). Dairy Queens are bigger in summer.</span>'
    : '<span class="warnline"><b>Cases:</b> no weeks yet. An administrator turns on the weekly route report in the United Dairy Hub, Administration > Accounting Numbers.</span>';
}
const emptyText = () => data.canImport ? 'The customer list is empty. Press Upload Route Menu, or upload the master list on Customers.' : 'The customer list is empty. An administrator uploads it from the Route Menu workbook.';

/* ---------- a customer's card (the same card as on Customers, udcl-card.js) ---------- */
function openCustomer(key) {
  const c = key ? data.customers[key] : null;
  const ds = c ? U.customerRows({ [key]: c }, allLines)[0].deliveries : [];
  const routesHtml = c ? (c.active === false ? '<b>Not on the Route Menu any more</b><br>' : '') + (ds.length ? ds.map(d => '<a href="route-sequence.html?route=' + encodeURIComponent(d.route) + '&day=' + d.day + '">' + e(dayName(d.day)) + ' route ' + e(d.route) + ', stop ' + d.stop + '</a>').join('<br>') : 'Not on any route day') : '';
  openCard({ data, key, routesHtml, onSaved: (cust, oldKey, out) => {
    (out.routeDays || []).forEach(rd => { const i = data.routeDays.findIndex(x => x.route === rd.route && x.day === rd.day); if (i >= 0) data.routeDays[i] = rd; });
    rebuild();
  } });
}

/* ---------- import ---------- */
function sheetRows(X, wb, name) { const ws = wb.Sheets[name]; return ws ? X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; }
function findSheet(wb, want) { return wb.SheetNames.find(n => n.trim().toLowerCase() === want.toLowerCase()); }

function openImport() {
  panel('Upload the Route Menu', '<p>Pick the <b>Route Menu</b> workbook (it decides every customer, route, day and load sequence). Pick the <b>Route Book</b> too if you have it: its run order, start times, keys, instructions and truck drawings replace what is here.</p>' +
    '<label>Route Menu workbook (.xlsb, .xlsx)<input type="file" id="i-menu" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<label>Route Book workbook (optional)<input type="file" id="i-book" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<button type="button" class="primary" id="i-go">Upload</button><div id="i-msg"></div>' +
    '<p class="deliveries">The master list (addresses, GPS, phones) is uploaded on <b>Customers</b>, Update the file.</p><hr>' +
    '<p>No workbook at hand? Bring over the list already uploaded for the Sales app (no load sequence or addresses).</p><button type="button" id="i-sales">Bring over the Sales app list</button><hr>' +
    '<p class="deliveries">A new upload overrules what was changed here: whatever the workbooks have wins. What they do not have stays as typed (phones, contacts, notes, stop notes, and the run order and load maps when no Route Book is picked). Changes made here stay until the next upload. A route day no longer in the Route Menu is removed.</p>');
  const say = (t, cls) => { $('i-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
  $('i-go').onclick = async () => {
    const mf = $('i-menu').files[0], bf = $('i-book').files[0];
    if (!mf) return say('Pick the Route Menu workbook first.', 'bad');
    try {
      say('Reading ' + mf.name + '…');
      const X = await loadXlsx(), wb = X.read(await mf.arrayBuffer(), { type: 'array' });
      const tab = findSheet(wb, 'Customer By Route');
      const menu = tab ? U.menuStops(sheetRows(X, wb, tab)) : null;
      if (!menu || !menu.stops.length) return say('No "Customer By Route" tab with Day, Route and Name headings was found in ' + mf.name + '. This box takes only the Route Menu workbook: the master address list goes in on Customers, Update the file.', 'bad');
      const accounts = new Set(menu.stops.concat(menu.unrouted).map(s => s.account).filter(Boolean)), names = new Set(menu.stops.concat(menu.unrouted).map(s => U.nameKey(s.name)));
      const at = findSheet(wb, 'Address List'), gt = findSheet(wb, 'GPS Address');
      const allAddr = at ? U.addressList(sheetRows(X, wb, at)) : {}, allGps = gt ? U.gpsAddresses(sheetRows(X, wb, gt)) : {};
      const addresses = {}, gps = {};
      accounts.forEach(a => { if (allAddr[a]) addresses[a] = allAddr[a]; });
      names.forEach(n => { if (allGps[n]) gps[n] = allGps[n]; });
      let book = {};
      if (bf) { say('Reading ' + bf.name + '…'); const bw = X.read(await bf.arrayBuffer(), { type: 'array' }); const sheets = {}; bw.SheetNames.forEach(n => { sheets[n] = sheetRows(X, bw, n); }); book = U.routeBook(sheets); }
      say('Saving ' + menu.stops.length + ' delivery lines…');
      const out = await saveStep('importMenu', { stops: menu.stops, unrouted: menu.unrouted, addresses, gps, book, fileName: mf.name + (bf ? ' + ' + bf.name : ''), thenView: true });
      setData(out);
      const c = out.counts;
      say(out.message + ' ' + c.added + ' new customers, ' + c.filled + ' had their address or keys filled in, ' + c.inactive + ' no longer on the Route Menu, ' + c.removedDays + ' route days removed.' + (c.noLoadSeq ? ' ' + c.noLoadSeq + ' stops have no load sequence in the Route Menu: give them one on Route Book.' : ''), 'good');
    } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  };
  $('i-sales').onclick = async () => {
    try { const out = await saveStep('copySales', { thenView: true }); setData(out); say(out.message, 'good'); } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  };
}

/* ---------- print ---------- */
function printItems() {
  if (!data) return [];
  const fl = f(), pn = data.plantName, filt = [fl.route && 'route ' + fl.route, fl.day && dayName(fl.day), fl.chain && 'chain ' + fl.chain, fl.q && '"' + fl.q + '"'].filter(Boolean).join(', ');
  const lineCols = [['Day', l => dayName(l.day).slice(0, 3), 1], ['Route', l => l.route, 1], ['Run Seq', l => l.stop, 1], ['Load Seq', l => l.loadSeq || '', 1], ['Account', l => l.account], ['Customer', l => l.name], ['Address', l => U.addressLine(l)], ['Note', l => l.note]];
  const rds = sortedRouteDays(data.routeDays).filter(rd => (!fl.route || rd.route === fl.route) && (!fl.day || rd.day === fl.day));
  return [
    { label: 'This list, as shown', note: (filt ? 'Only ' + filt : 'Everything') + ', in this order', html: () => view === 'list'
      ? printDoc('Customer directory', [tablePage('Customer directory · ' + pn, filt || 'All customers', customersShown(), dirCols)])
      : view === 'customer'
      ? printDoc('Routes', [tablePage('Routes · ' + pn, filt || 'All customers', customersShown(), [['Chain', c => c.chain, 1], ['Account', c => c.account], ['Customer', c => c.name], ['DC', c => dcPlain(c.dc)]].concat(dayCols))])
      : printDoc('Deliveries', [tablePage('Deliveries · ' + pn, filt || 'All deliveries', U.pick(allLines, fl), lineCols, view === 'route' ? (l => 'Route ' + l.route + ' · ' + dayName(l.day)) : (l => dayName(l.day) + ' · Route ' + l.route))]) },
    { label: 'Route sequence sheets for the office', note: rds.length + ' route day' + (rds.length === 1 ? '' : 's') + (filt ? ' (' + filt + ')' : '') + ', one page each', html: () => printDoc('Route sequence', rds.map(rd => routeDayPage(rd, data.customers, 'office', pn))) },
    { label: 'Driver route book pages', note: rds.length + ' route day' + (rds.length === 1 ? '' : 's') + ', with keys, time in / out and the load map', html: () => printDoc('Route book', rds.map(rd => routeDayPage(rd, data.customers, 'driver', pn))) },
    { label: 'Customer list by route', note: 'Every route, its days and customers', html: () => printDoc('Customers by route', [tablePage('Customers by route · ' + pn, 'Route, day, stop', U.pick(allLines, Object.assign({}, fl, { sort: 'route' })), lineCols, l => 'Route ' + l.route + ' · ' + dayName(l.day))]) },
    { label: 'Customer list by day', note: 'Every day, its routes and customers', html: () => printDoc('Customers by day', [tablePage('Customers by day · ' + pn, 'Day, route, stop', U.pick(allLines, Object.assign({}, fl, { sort: 'day' })), lineCols, l => dayName(l.day))]) },
    { label: 'Customer addresses and phones', note: 'One line per customer, by name', html: () => printDoc('Customer addresses', [tablePage('Customer addresses · ' + pn, filt || 'All customers', customersShown(), [['Account', c => c.account], ['Customer', c => c.name], ['Address', c => U.addressLine(c)], ['Phone', c => c.phone], ['Contact', c => c.contact], ['Keys / door code', c => c.keys]])]) }
  ];
}

function rebuild() {
  allLines = U.lines(data.customers, data.routeDays);
  allCustomers = U.customerRows(data.customers, allLines);
  allCustomers.forEach(c => { c.findText = [c.name, c.account, c.city, c.chain, c.group, c.address, U.dcName(c.dc)].join(' ').toUpperCase(); });
  fillPickers(); draw();
}
function setData(d) {
  data = Object.assign({}, data || {}, d);
  $('plant-name').textContent = data.plantName || '';
  $('add').hidden = !data.canEdit; $('import').hidden = !data.canImport;
  rebuild();
}

document.querySelectorAll('#views button').forEach(b => { b.onclick = () => { view = b.dataset.view; $('sort').value = ''; shown = PAGE; history.replaceState(null, '', '?view=' + view); remember(); draw(); }; });
let typing = null;
['q', 'route', 'day', 'chain', 'dcpick', 'sort'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => {
  shown = PAGE; clearTimeout(typing);
  if (id === 'q') typing = setTimeout(draw, 200); else { remember(); draw(); }
}));
$('rows').addEventListener('click', ev => {
  const more = ev.target.closest('button[data-more]');
  if (more) { shown = more.dataset.more === 'all' ? Infinity : shown + PAGE; draw(); return; }
  if (ev.target.closest('a, select, input, button, label')) return; const tr = ev.target.closest('tr[data-key]'); if (tr) openCustomer(tr.dataset.key); });
// Joe 11-10-26: on By Customer, a ticked or unticked day, or a new route number, saves that line by itself.
$('rows').addEventListener('change', ev => {
  if (view !== 'customer') return;
  const x = ev.target.closest('input[type="checkbox"], input.rt'), tr = x && x.closest('tr[data-key]');
  if (tr) saveLine(tr);
});
$('rows').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('input.rt')) ev.target.blur(); });
// Joe 11-6-26: PALLET USES saves by itself for that customer on that route day.
$('rows').addEventListener('change', async ev => {
  const sel = ev.target.closest('select.uses');
  if (!sel) return;
  sel.disabled = true;
  try {
    const out = await saveStep('setPalletUses', { route: sel.dataset.route, day: sel.dataset.day, key: sel.dataset.key, rule: sel.value });
    const rd = data.routeDays.find(x => x.route === out.route && x.day === out.day);
    if (rd) rd.palletUses = out.palletUses;
    showError(''); rebuild();
  } catch (err) { showError(serverText(err, 'the customer list')); sel.disabled = false; }
});
$('add').onclick = () => openCustomer(null);
$('import').onclick = openImport;
printMenu($('udcl-print-menu'), printItems);

requireSignIn(async () => {
  try { setData(await readList({ cases: true })); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
