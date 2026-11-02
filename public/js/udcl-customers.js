// Customers (United Dairy Customer List, Joe 11/1): every customer by customer, by route or by day, with the boxes to find,
// filter and sort, a customer's own card (address, phone, keys or door code, notes) and the Print menu. An Administrator imports the
// Route Menu workbook here (and the Route Book with it), or brings over the Sales app's list.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { readList, saveStep, printMenu, printDoc, tablePage, routeDayPage, sortedRouteDays, routesOf, U } from './udcl.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const el = document.createElement('script'); el.src = XLSX_URL; el.onload = () => ok(window.XLSX); el.onerror = () => bad(new Error('Could not load the Excel reader. Check the network and try again.')); document.head.appendChild(el); });

const params = new URLSearchParams(location.search);
// Joe 11/2: the Customer Address List moved to Administration as the Master Customer List.
if (params.get('view') === 'master') location.replace('master-customers.html');
let data = null, view = ['customer', 'route', 'day', 'list'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'customer';
// Worked out once each time the list changes (rebuild), not at every click: the lines, and one row per customer with its deliveries
// and the text Find looks in.
let allLines = [], allCustomers = [];
const $ = (id) => document.getElementById(id);
const f = () => ({ q: $('q').value, route: $('route').value, day: $('day').value, chain: $('chain').value, dc: $('dcpick').value, sort: $('sort').value || view });
const dayName = (d) => U.DAY_NAMES[d] || d;

function fillPickers() {
  const keep = (id, opts, all) => { const box = $(id), was = box.value; box.innerHTML = '<option value="">' + all + '</option>' + opts.map(([v, t]) => '<option value="' + e(v) + '">' + e(t) + '</option>').join(''); box.value = opts.some(o => o[0] === was) ? was : ''; };
  keep('route', routesOf(data.routeDays).map(r => [r, 'Route ' + r]), 'All routes');
  keep('day', U.DAYS.map(d => [d, dayName(d)]), 'All days');
  const chains = [...new Set(Object.values(data.customers).map(c => c.chain).filter(Boolean))].sort(U.byRoute);
  keep('chain', chains.map(c => [c, 'Chain ' + c]), 'All chains');
  const dcs = [...new Set(Object.values(data.customers).map(c => U.dcOf(c.dc)).filter(Boolean))].sort(U.byRoute);
  keep('dcpick', dcs.map(d => [d, dcPlain(d)]), 'All DCs');
  if (params.get('route') && !$('route').value) $('route').value = params.get('route');
}

/** The customers picked by the boxes, one row each (a customer with no delivery shows only when no route or day is picked). */
function customersShown() {
  const fl = f(), lines = U.pick(allLines, Object.assign({}, fl, { sort: 'customer' }));
  const keys = new Set(lines.map(l => l.key));
  const words = U.text(fl.q).toUpperCase().split(' ').filter(Boolean);
  const rows = allCustomers.filter(c => (keys.has(c.key) || (!fl.route && !fl.day && (!fl.chain || c.chain === fl.chain) && !c.deliveries.length &&
    words.every(w => c.findText.indexOf(w) >= 0))) && (!fl.dc || U.dcOf(c.dc) === fl.dc));
  const s = fl.sort === 'customer' || !U.SORTS[fl.sort] ? null : fl.sort;
  if (s === 'account') rows.sort((a, b) => U.byRoute(a.account, b.account));
  else if (s === 'city') rows.sort((a, b) => U.byName(a.city, b.city) || U.byName(a.name, b.name));
  else if (s === 'chain') rows.sort((a, b) => U.byRoute(a.chain || 'zz', b.chain || 'zz') || U.byName(a.name, b.name));
  else if (s === 'route' || s === 'day') rows.sort((a, b) => { const x = (a.deliveries || [])[0] || {}, y = (b.deliveries || [])[0] || {}; return s === 'route' ? U.byRoute(x.route || 'zz', y.route || 'zz') || U.dayIndex(x.day) - U.dayIndex(y.day) : U.dayIndex(x.day) - U.dayIndex(y.day) || U.byRoute(x.route || 'zz', y.route || 'zz'); });
  return rows;
}
// Joe 11/2: the Customers list shows Chain, Account, Customer, DC (its name only), Address, then a column per day (Sun to Sat)
// holding the route that delivers that day, with no stop number.
const routesOn = (c, day) => [...new Set((c.deliveries || []).filter(d => d.day === day).map(d => d.route))].join(', ');
const dcPlain = (v) => U.dcName(v).replace(/^\d+\s+/, '');
// Joe 11/2: a Group column on the Directory, picked from a drop-down, with a new group added from the same list.
const groupsNow = () => [...new Set(Object.values(data.customers).map(c => c.group).filter(Boolean))].sort(U.byName);
// The group list is worked out once per drawing (Joe 11/2: with 5,118 customers, once per line made the screen crawl).
let groupList = [];
const groupCell = (c) => !data.canEdit ? e(c.group || '') : '<select class="grp" data-key="' + e(c.key) + '" aria-label="Group for ' + e(c.name) + '"><option value="">No group</option>' +
  groupList.map(g => '<option' + (g === c.group ? ' selected' : '') + '>' + e(g) + '</option>').join('') + '<option value="+">+ Add a group…</option></select>';
// Only the first lines are drawn; "Show more" adds the next ones. Narrowing the boxes starts again from the top.
const PAGE = 300;
let shown = PAGE;
const page = (rows) => rows.slice(0, shown);
const moreRow = (rows, cols) => rows.length > shown ? '<tr class="more"><td colspan="' + cols + '">Showing ' + shown.toLocaleString() + ' of ' + rows.length.toLocaleString() +
  ' &nbsp; <button type="button" data-more="' + PAGE + '">Show ' + Math.min(PAGE, rows.length - shown) + ' more</button> <button type="button" data-more="all">Show all</button></td></tr>' : '';
// Joe 11/2: the Directory tab, "just ... the customer list with the addresses and the GPS coordinates ... and the phone numbers. Not the routes".
const gpsText = (c) => (c.lat && c.lon) ? Number(c.lat).toFixed(5) + ', ' + Number(c.lon).toFixed(5) : '';
const dirCols = [['DC', c => dcPlain(c.dc), 1], ['Chain', c => c.chain, 1], ['Group', c => c.group || ''], ['Account', c => c.account], ['Customer', c => c.name], ['Address', c => U.addressLine(c)], ['GPS', c => gpsText(c)], ['Phone', c => c.phone], ['Address check', c => c.addressCheck || '']];
const dayCols = U.DAYS.map(d => [dayName(d).slice(0, 3), c => routesOn(c, d), 1]);

function draw() {
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  ['route', 'day'].forEach(id => { $(id).closest('.field').hidden = view === 'list'; });
  if (!data) return;
  const fl = f();
  groupList = groupsNow();
  drawFooter();
  if (view === 'list') {
    const rows = customersShown();
    $('thead').innerHTML = '<tr><th style="width:7%">DC</th><th style="width:5%">Chain</th><th class="l" style="width:13%">Group</th><th style="width:7%">Account</th><th class="l" style="width:18%">Customer</th><th class="l">Address</th><th style="width:11%">GPS</th><th class="l" style="width:9%">Phone</th><th class="l" style="width:10%">Address check</th></tr>';
    $('rows').innerHTML = page(rows).map(c => '<tr class="pick' + (c.active === false ? ' inactive' : '') + '" data-key="' + e(c.key) + '"><td>' + e(dcPlain(c.dc)) + '</td><td>' + e(c.chain) + '</td><td class="l grp-cell">' + groupCell(c) + '</td><td>' + e(c.account) + '</td><td class="l"><b>' + e(c.name) + '</b></td>' +
      '<td class="l" title="' + e(U.addressLine(c)) + '">' + (U.addressLine(c) ? e(U.addressLine(c)) : '<span class="warnline">No address yet</span>') + '</td>' +
      '<td>' + (gpsText(c) ? '<a href="https://www.google.com/maps?q=' + encodeURIComponent(c.lat + ',' + c.lon) + '" target="_blank" rel="noopener" title="Open in Google Maps">' + e(gpsText(c)) + '</a>' : '<span class="warnline">-</span>') + '</td><td class="l">' + e(c.phone) + '</td><td class="l" title="' + e([c.addressNote, c.addressProposed && ('Proposed: ' + c.addressProposed), c.gpsFrom && ('GPS from ' + c.gpsFrom)].filter(Boolean).join(' · ')) + '"><small>' + e(c.addressCheck || '') + '</small></td></tr>').join('') + moreRow(rows, 9) ||
      '<tr><td colspan="9" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
  } else if (view === 'customer') {
    const rows = customersShown();
    // Joe 11/2: Chain and the day columns narrower again, and the Group drop-down here too.
    $('thead').innerHTML = '<tr><th style="width:4%">Chain</th><th class="l" style="width:11%">Group</th><th style="width:7%">Account</th><th class="l" style="width:17%">Customer</th><th style="width:7%">DC</th><th class="l">Address</th>' +
      U.DAYS.map(d => '<th class="dayroute" style="width:3.9%">' + e(dayName(d).slice(0, 3)) + '</th>').join('') + '</tr>';
    $('rows').innerHTML = page(rows).map(c => '<tr class="pick' + (c.active === false ? ' inactive' : '') + '" data-key="' + e(c.key) + '"><td>' + e(c.chain) + '</td><td class="l grp-cell">' + groupCell(c) + '</td><td>' + e(c.account) + '</td><td class="l"><b>' + e(c.name) + '</b></td><td>' + e(dcPlain(c.dc)) + '</td>' +
      '<td class="l" title="' + e(U.addressLine(c)) + '">' + (U.addressLine(c) ? e(U.addressLine(c)) : '<span class="warnline">No address yet</span>') + '</td>' +
      U.DAYS.map(d => '<td class="dayroute">' + e(routesOn(c, d)) + '</td>').join('') + '</tr>').join('') + moreRow(rows, 13) ||
      '<tr><td colspan="13" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = rows.length + ' customer' + (rows.length === 1 ? '' : 's');
  } else {
    const lines = U.pick(allLines, fl);
    const grp = (l) => view === 'route' && (!$('sort').value || $('sort').value === 'route') ? 'Route ' + l.route + ' · ' + dayName(l.day) : view === 'day' && (!$('sort').value || $('sort').value === 'day') ? dayName(l.day) + ' · Route ' + l.route : '';
    $('thead').innerHTML = '<tr><th style="width:8%">Day</th><th style="width:7%">Route</th><th style="width:7%">Run Seq</th><th style="width:7%">Load Seq</th><th style="width:9%">Account</th><th class="l" style="width:24%">Customer</th><th class="l" style="width:16%">City</th><th class="l">Stop note</th></tr>';
    let last = null;
    $('rows').innerHTML = lines.map(l => {
      const g = grp(l), head = g && g !== last ? '<tr class="group"><td colspan="8" class="l">' + e(g) + ' &nbsp; <a href="route-sequence.html?route=' + encodeURIComponent(l.route) + '&day=' + l.day + '">Open in Route Book &rarr;</a></td></tr>' : '';
      last = g;
      return head + '<tr class="pick" data-key="' + e(l.key) + '"><td>' + e(dayName(l.day).slice(0, 3)) + '</td><td>' + e(l.route) + '</td><td><span class="stopno">' + l.stop + '</span></td><td>' + (l.loadSeq || '<span class="warnline">-</span>') + '</td><td>' + e(l.account) + '</td><td class="l"><b>' + e(l.name) + '</b></td><td class="l">' + e(l.city) + '</td><td class="l">' + e(l.note) + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty">' + (allLines.length ? 'No delivery matches these boxes.' : emptyText()) + '</td></tr>';
    $('count').textContent = lines.length + ' deliver' + (lines.length === 1 ? 'y' : 'ies');
  }
}
const lastUpload = (m) => m ? (m.fileName || 'a file') + ', ' + shortDate(m.at) + ' by ' + m.by : '';
function drawFooter() {
  const im = data.imported, ms = data.master;
  $('imported').innerHTML = [im && '<span><b>Route Menu:</b> ' + e(lastUpload(im)) + ' · ' + (im.counts.customers || 0) + ' customers, ' + (im.counts.routeDays || 0) + ' route days' +
    (im.counts.noLoadSeq ? ' · <span class="warnline">' + im.counts.noLoadSeq + ' stops have no load sequence yet</span>' : '') + '</span>',
    ms && '<span><b>Master list:</b> ' + e(lastUpload(ms)) + '</span>'].filter(Boolean).join('');
}
const emptyText = () => data.canImport ? 'The customer list is empty. Press Upload Route Menu, or upload the master list on Administration, Master Customer List.' : 'The customer list is empty. An administrator uploads it from the Route Menu workbook.';

/* ---------- a customer's card ---------- */
function panel(title, body) {
  closePanel();
  const p = document.createElement('aside');
  p.className = 'udcl-panel'; p.id = 'panel';
  p.innerHTML = '<header><h2>' + e(title) + '</h2><button type="button" id="p-close">Close</button></header><div class="body">' + body + '</div>';
  document.body.appendChild(p);
  $('p-close').onclick = closePanel;
  window.udBack = () => { if ($('panel')) { closePanel(); return true; } return false; };
  return p;
}
function closePanel() { const p = $('panel'); if (p) p.remove(); window.udBack = null; }

function openCustomer(key) {
  const c = key ? data.customers[key] : null, add = !c, ro = !data.canEdit;
  const v = (k) => e(c && c[k] !== undefined && c[k] !== null ? c[k] : '');
  const dis = ro ? ' disabled' : '';
  const ds = c ? U.customerRows({ [key]: c }, allLines)[0].deliveries : [];
  const p = panel(add ? 'Add a customer' : c.name, (add ? '<label>Account number<input id="c-account" inputmode="numeric" placeholder="Leave blank if it has none"></label>' : '<div class="deliveries">Account ' + v('account') + (c.active === false ? ' · <b>Not on the Route Menu any more</b>' : '') + '<br>' + (ds.length ? ds.map(d => '<a href="route-sequence.html?route=' + encodeURIComponent(d.route) + '&day=' + d.day + '">' + e(dayName(d.day)) + ' route ' + e(d.route) + ', stop ' + d.stop + '</a>').join('<br>') : 'Not on any route day') + '</div>') +
    '<label>Name<input id="c-name" value="' + v('name') + '"' + dis + '></label>' +
    '<div class="two"><label>Chain<input id="c-chain" value="' + v('chain') + '"' + dis + '></label><label>Phone<input id="c-phone" value="' + v('phone') + '"' + dis + '></label></div>' +
    '<label>Distribution center<select id="c-dc"' + dis + '><option value="">Not set</option>' + (c && U.dcOf(c.dc) && !U.DCS.some(d => d.code === U.dcOf(c.dc)) ? [{ code: U.dcOf(c.dc), name: 'DC ' + U.dcOf(c.dc) }] : []).concat(U.DCS).map(d => '<option value="' + d.code + '"' + ((c ? U.dcOf(c.dc) : (U.PLANT_DC[data.plant] || '')) === d.code ? ' selected' : '') + '>' + d.code + ' ' + e(d.name) + '</option>').join('') + '</select></label>' +
    (c && (c.addressCheck || c.addressProposed) ? '<div class="deliveries">Address check: ' + e(c.addressCheck || '') + (c.addressProposed ? '<br>Proposed address: <b>' + e(c.addressProposed) + '</b>' : '') + (c.addressNote ? '<br>' + e(c.addressNote) : '') + (c.lat && c.lon ? '<br>GPS ' + e(gpsText(c)) + (c.gpsFrom ? ' (' + e(c.gpsFrom) + ')' : '') : '') + '</div>' : '') +
    '<label>Street<input id="c-address" value="' + v('address') + '"' + dis + '></label><label>Street, line 2<input id="c-address2" value="' + v('address2') + '"' + dis + '></label>' +
    '<div class="three"><label>City<input id="c-city" value="' + v('city') + '"' + dis + '></label><label>State<input id="c-state" value="' + v('state') + '" maxlength="4"' + dis + '></label><label>Zip<input id="c-zip" value="' + v('zip') + '"' + dis + '></label></div>' +
    '<label>Contact<input id="c-contact" value="' + v('contact') + '"' + dis + '></label>' +
    '<label>Keys or door code<input id="c-keys" value="' + v('keys') + '"' + dis + '></label>' +
    '<label>Notes for the driver (shows on the route book at every stop for this customer)<textarea id="c-notes"' + dis + '>' + v('notes') + '</textarea></label>' +
    (add ? '<button type="button" class="primary" id="c-save">Add customer</button>' : '') + '<div id="c-msg"></div>');
  const fields = () => { const o = {}; U.CUSTOMER_FIELDS.forEach(k => { const el = $('c-' + k); if (el) o[k] = el.value; }); return o; };
  const say = (t, cls) => { $('c-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
  if (ro) return;
  if (add) {
    $('c-save').onclick = async () => {
      try { const out = await saveStep('saveCustomer', { add: true, account: $('c-account').value, fields: fields() }); data.customers[out.customer.key] = out.customer; rebuild(); openCustomer(out.customer.key); }
      catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
    };
    return;
  }
  // Every box saves when it is left (as everywhere in Operations).
  p.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('change', async () => {
    try { const out = await saveStep('saveCustomer', { key, fields: { [el.id.slice(2)]: el.value } }); data.customers[key] = out.customer; rebuild(); say('Saved.', 'good'); }
    catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  }));
}

/* ---------- import ---------- */
function sheetRows(X, wb, name) { const ws = wb.Sheets[name]; return ws ? X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; }
function findSheet(wb, want) { return wb.SheetNames.find(n => n.trim().toLowerCase() === want.toLowerCase()); }

function openImport() {
  panel('Upload the Route Menu', '<p>Pick the <b>Route Menu</b> workbook (it decides every customer, route, day and load sequence). Pick the <b>Route Book</b> too if you have it: its run order, start times, keys, instructions and truck drawings replace what is here.</p>' +
    '<label>Route Menu workbook (.xlsb, .xlsx)<input type="file" id="i-menu" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<label>Route Book workbook (optional)<input type="file" id="i-book" accept=".xlsx,.xlsb,.xls,.xlsm"></label>' +
    '<button type="button" class="primary" id="i-go">Upload</button><div id="i-msg"></div>' +
    '<p class="deliveries">The master list (addresses, GPS, phones) is uploaded on <b>Administration</b>, <b>Master Customer List</b>.</p><hr>' +
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
      if (!menu || !menu.stops.length) return say('No "Customer By Route" tab with Day, Route and Name headings was found in ' + mf.name + '. This box takes only the Route Menu workbook: the master address list goes in on Administration, Master Customer List.', 'bad');
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
      ? printDoc('Customers', [tablePage('Customers · ' + pn, filt || 'All customers', customersShown(), [['Chain', c => c.chain, 1], ['Group', c => c.group || ''], ['Account', c => c.account], ['Customer', c => c.name], ['DC', c => dcPlain(c.dc), 1], ['Address', c => U.addressLine(c)]].concat(dayCols))])
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

document.querySelectorAll('#views button').forEach(b => { b.onclick = () => { view = b.dataset.view; $('sort').value = ''; shown = PAGE; history.replaceState(null, '', '?view=' + view); draw(); }; });
let typing = null;
['q', 'route', 'day', 'chain', 'dcpick', 'sort'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => {
  shown = PAGE; clearTimeout(typing);
  if (id === 'q') typing = setTimeout(draw, 200); else draw();
}));
async function saveGroup(key, group) {
  try { const out = await saveStep('saveCustomer', { key, fields: { group } }); data.customers[key] = out.customer; showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
  rebuild();
}
$('rows').addEventListener('change', ev => {
  const sel = ev.target.closest('select.grp');
  if (sel) {
    if (sel.value !== '+') return saveGroup(sel.dataset.key, sel.value);
    // "+ Add a group…": the box becomes a place to type the new group's name; Enter or leaving it saves it.
    const box = document.createElement('input');
    box.className = 'grp-new'; box.placeholder = 'New group name'; box.maxLength = U.LIMITS.group; box.dataset.key = sel.dataset.key;
    sel.replaceWith(box); box.focus();
    let done = false;
    const finish = () => { if (done) return; done = true; const v = box.value.trim(); if (v) saveGroup(box.dataset.key, v); else draw(); };
    box.addEventListener('keydown', k => { if (k.key === 'Enter') finish(); if (k.key === 'Escape') { done = true; draw(); } });
    box.addEventListener('blur', finish);
  }
});
$('rows').addEventListener('click', ev => {
  const more = ev.target.closest('button[data-more]');
  if (more) { shown = more.dataset.more === 'all' ? Infinity : shown + PAGE; draw(); return; }
  if (ev.target.closest('a, select, input, button')) return; const tr = ev.target.closest('tr[data-key]'); if (tr) openCustomer(tr.dataset.key); });
$('add').onclick = () => openCustomer(null);
$('import').onclick = openImport;
printMenu($('udcl-print-menu'), printItems);

requireSignIn(async () => {
  try { setData(await readList()); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
