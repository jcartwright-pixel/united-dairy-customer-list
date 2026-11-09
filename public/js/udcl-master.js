// Customers, the master customer list (Joe 11/2; its own tab since 11/3, it was in Administration): "basically a master customer list. It will show all of them", every
// distribution center, with Active or Inactive first ("If it is inactive, then it's not showing anywhere else in our system"),
// a Sort by box (location, then A to Z) and a sort on every heading. The master address file is uploaded here.
// Joe 11/3: the list gets the room. One slim bar on top, the totals in one line at the bottom, the upload in its own box.
// Joe 11/3: "clicking inactive ... is extremely slow", "I'd like to be able to double click ... to go between active and inactive",
// and a lot of them at once. Double-click a status to switch it. Click rows (Shift-click for a run, or drag down the list) to pick
// many, then Make inactive / Make active. A change saves only those customers and redraws only their lines.
// Joe 11/3: "There is where I want to be able to edit the group", in the Group column, before Chain. Click a group to change it,
// or pick lines and set one group for all of them. The groups themselves are added on Administration.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { readList, saveStep, savedView, saveView, printMenu, printDoc, tablePage, U } from './udcl.js';
import { openCard, groupOptions, askNewGroup } from './udcl-card.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const el = document.createElement('script'); el.src = XLSX_URL; el.onload = () => ok(window.XLSX); el.onerror = () => bad(new Error('Could not load the Excel reader. Check the network and try again.')); document.head.appendChild(el); });
const sheetRows = (X, wb, name) => { const ws = wb.Sheets[name]; return ws ? X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; };
const $ = (id) => document.getElementById(id);
let data = null;

// Joe 11/3: only a branch is a location (a route number the master file put in its DC column is not shown as one).
const dcLabel = (v) => { const d = U.branchOf(v); return d ? U.dcName(d).replace(/ DC \d+$/, '') : ''; };
const statusOf = (c) => c.inactive ? 'Inactive' : 'Active';
// Joe 11/6: no Route, Second line, Latitude, Longitude, Match status or Coordinate source, and the list fits the screen with no
// sideways scroll. The widths add up to 100% with the pick box (2.2%).
// [heading, value, centred, width, cut long text]
const COLS = [['Status', statusOf, 1, '6.3%'], ['DC', c => dcLabel(c.dc), 0, '8.5%'], ['Group', c => c.group || '', 0, '8%', 1], ['Chain', c => c.chain, 1, '4.5%'],
  ['Account', c => c.account, 1, '6%'], ['Customer', c => c.name, 0, '21%', 1], ['Street', c => c.address, 0, '17%', 1], ['City', c => c.city, 0, '10%', 1],
  ['State', c => c.state, 1, '4%'], ['ZIP', c => c.zip, 1, '5%'], ['Phone', c => c.phone, 0, '7.5%', 1]];
const colAt = (name) => COLS.findIndex(c => c[0] === name);
const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// The Sort by box: each is a list of [column, direction]. A heading pressed sorts by it (again: the other way).
const GROUP = colAt('Group'), NAME = colAt('Customer'), CITY = colAt('City');
const PRESETS = { location: [[1, 1], [NAME, 1]], name: [[NAME, 1]], city: [[CITY, 1], [NAME, 1]], status: [[0, -1], [1, 1], [NAME, 1]] };
const DC_NUM = (c) => Number(U.branchOf(c.dc)) || 99999;
const PAGE = 300;
// Joe 11/3: "save the view option". The sort (a Sort by choice or the heading pressed), the location and the status stay as they
// were left, on this computer; the screen opens with them.
let saved = savedView('customers');
// Joe 11/6: "the default should be only view active and the default location should be set to Uniontown". With nothing kept yet
// (a new computer or person), the status box starts on Active and the location box on the plant's own DC (30 Uniontown).
if (saved.status === undefined) saved.status = 'Active';
// The heading sort is kept by heading name, so it still means the same column when columns come and go.
const savedOrder = Array.isArray(saved.sortBy) && saved.sortBy.length && saved.sortBy.every(x => Array.isArray(x) && colAt(x[0]) >= 0 && (x[1] === 1 || x[1] === -1)) ? saved.sortBy.map(([n, d]) => [colAt(n), d]) : null;
if (!savedOrder && saved.sort === '') saved.sort = 'location';
let order = savedOrder || PRESETS[saved.sort] || PRESETS.location, shown = PAGE;
const remember = () => saveView('customers', { sort: $('sort').value, sortBy: order.map(([i, d]) => [COLS[i][0], d]), dc: $('dcpick').value, status: $('status').value });
let rowsNow = [];                 // the customers the boxes pick, in order (drawn or not)
const picked = new Set();         // the customers picked for Make inactive / Make active
let anchor = null;                // where a Shift-click run starts

function shownRows() {
  const words = U.text($('q').value).toUpperCase().split(' ').filter(Boolean), dc = $('dcpick').value, st = $('status').value;
  const rows = Object.values(data.customers).filter(c => (!dc || (dc === 'none' ? !U.branchOf(c.dc) : U.branchOf(c.dc) === dc)) && (!st || statusOf(c) === st) &&
    (!words.length || (() => { const t = [c.name, c.account, c.chain, c.city, c.address, c.zip, c.phone, c.group, dcLabel(c.dc), U.dcRoute(c.dc)].join(' ').toUpperCase(); return words.every(w => t.indexOf(w) >= 0); })()));
  // Each sort value is worked out once per customer, not on every comparison (5,000 customers sort at once).
  const keyOf = (i, c) => i === 1 ? DC_NUM(c) : COLS[i][1](c);
  const blank = (v) => v === '' || v === null || v === undefined;
  const keyed = rows.map(c => ({ c, k: order.map(([i]) => keyOf(i, c)) }));
  keyed.sort((a, b) => {
    for (let n = 0; n < order.length; n++) {
      const x = a.k[n], y = b.k[n];
      if (x === y) continue;
      if (blank(x)) return 1;                                            // blanks last, either way
      if (blank(y)) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y));
      if (r) return r * order[n][1];
    }
    return 0;
  });
  return keyed.map(x => x.c);
}

const groupCell = (c) => data.canEdit ? '<button type="button" class="grp' + (c.group ? '' : ' none') + '" data-key="' + e(c.key) + '" title="Click to change the group">' + e(c.group || 'No group') + '</button>' : e(c.group || '');
const statusCell = (c) => '<button type="button" class="st ' + (c.inactive ? 'off' : 'on') + '" data-key="' + e(c.key) + '" title="Double-click to switch">' + statusOf(c) + '</button>';
function rowHtml(c) {
  return '<tr class="' + (c.inactive ? 'is-inactive' : '') + (picked.has(c.key) ? ' picked' : '') + '" data-key="' + e(c.key) + '"><td class="pick"><span class="box" aria-hidden="true"></span></td>' + COLS.map((col, i) => {
    const v = col[1](c);
    if (i === 0) return '<td>' + statusCell(c) + '</td>';
    if (i === GROUP) return '<td class="l grp-cell">' + groupCell(c) + '</td>';
    return '<td' + (col[2] ? '' : ' class="l"') + (col[4] ? ' title="' + e(v) + '"' : '') + '>' + (col[0] === 'Customer' ? '<b>' + e(v) + '</b>' : col[0] === 'Street' && !v ? '<span class="warnline">No address yet</span>' : e(v)) + '</td>';
  }).join('') + '</tr>';
}

function draw() {
  if (!data) return;
  rowsNow = shownRows();
  const head = order[0], width = COLS.length + 1;
  $('thead').innerHTML = '<tr><th class="pick"><button type="button" id="pick-all" class="box-btn" title="Pick every customer shown"><span class="box" aria-hidden="true"></span></button></th>' +
    COLS.map((c, i) => '<th' + (c[2] ? '' : ' class="l"') + (c[3] ? ' style="width:' + c[3] + '"' : '') + '><button type="button" class="sorter" data-col="' + i + '"' +
    (head[0] === i ? ' aria-sort="' + (head[1] > 0 ? 'ascending' : 'descending') + '"' : '') + ' title="Sort by ' + e(c[0]) + '">' + e(c[0]) + '<span class="arrow">' + (head[0] === i ? (head[1] > 0 ? ' &#9650;' : ' &#9660;') : '') + '</span></button></th>').join('') + '</tr>';
  $('rows').innerHTML = rowsNow.slice(0, shown).map(rowHtml).join('') + (rowsNow.length > shown ? '<tr class="more"><td colspan="' + width + '">Showing ' + shown.toLocaleString() + ' of ' + rowsNow.length.toLocaleString() +
    ' &nbsp; <button type="button" data-more="1">Show ' + Math.min(PAGE, rowsNow.length - shown) + ' more</button> <button type="button" data-more="all">Show all</button></td></tr>' : '') ||
    '<tr><td colspan="' + width + '" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : 'No customers yet. Press Update the file.') + '</td></tr>';
  drawCount(); drawPicked();
}

function drawCount() {
  const off = rowsNow.filter(c => c.inactive).length;
  $('count').textContent = rowsNow.length.toLocaleString() + ' customer' + (rowsNow.length === 1 ? '' : 's') + (off ? ' · ' + off.toLocaleString() + ' inactive' : '');
}

function drawStats() {
  const all = Object.values(data.customers), n = (fn) => all.filter(fn).length;
  const stat = (num, label, warn) => '<span class="ml-stat' + (warn && num ? ' warn' : '') + '"><b>' + num.toLocaleString() + '</b> ' + e(label) + '</span>';
  const last = (m, what) => m ? '<span>Last ' + what + ': <b>' + e(m.fileName || 'a file') + '</b>, ' + e(shortDate(m.at)) + ' by ' + e(m.by) + '</span>' : '';
  $('card-stats').innerHTML = stat(all.length, 'customers') + stat(n(c => !c.inactive), 'active') + stat(n(c => c.inactive), 'inactive') + stat(n(c => c.lat && c.lon), 'with GPS') +
    stat(n(c => c.phone), 'with a phone') + stat(n(c => !U.addressLine(c)), 'with no address yet', true);
  $('card-last').innerHTML = [last(data.master, 'master list'), last(data.addressSheet, 'checked addresses')].filter(Boolean).join('');
}

function drawLocations() {
  const all = Object.values(data.customers), dcs = [...new Set(all.map(c => U.branchOf(c.dc)).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const keep = saved ? (saved.dc === undefined ? U.PLANT_DC[data.plant] || '' : saved.dc || '') : $('dcpick').value, none = all.some(c => !U.branchOf(c.dc));
  $('dcpick').innerHTML = '<option value="">All locations</option>' + dcs.map(d => '<option value="' + e(d) + '">' + e((d + ' ' + dcLabel(d).replace(/^\d+\s*/, '')).trim()) + '</option>').join('') +
    (none ? '<option value="none">No branch</option>' : '');
  $('dcpick').value = dcs.includes(keep) || (keep === 'none' && none) ? keep : '';
  saved = null;
}

/** The picked count and its buttons in the top bar; the box on the heading shows all, some or none of the shown ones picked. */
function drawPicked() {
  [...picked].forEach(k => { if (!data.customers[k]) picked.delete(k); });
  $('picked').hidden = !picked.size;
  $('table-wrap').classList.toggle('has-picked', picked.size > 0);   // room under the last line for the floating bar
  $('picked-n').textContent = picked.size.toLocaleString() + ' picked';
  $('pick-group').hidden = !data.canEdit;
  $('pick-group').innerHTML = '<option value="">Set group…</option>' + groupsNow().map(g => '<option>' + e(g) + '</option>').join('') + '<option value="-">No group</option><option value="+">+ New group…</option>';
  $('pick-edit').hidden = picked.size !== 1;
  const inView = rowsNow.filter(c => picked.has(c.key)).length, all = $('pick-all');
  if (all) { all.classList.toggle('all', !!rowsNow.length && inView === rowsNow.length); all.classList.toggle('some', inView > 0 && inView < rowsNow.length); }
}

/* ---------- groups: click one to change it, or set one group on every picked line; "+ New group…" adds one (Joe 11/3) ---------- */
const groupsNow = () => data.groups || [];
const setGroups = (list) => { data.groups = list; drawPicked(); };
function showGroup(c) { const tr = rowOf(c.key); if (tr) tr.cells[1 + GROUP].innerHTML = groupCell(c); }
$('rows').addEventListener('click', ev => {
  const b = ev.target.closest('button.grp'); if (!b) return;
  const c = data.customers[b.dataset.key]; if (!c) return;
  const sel = document.createElement('select');
  sel.className = 'grp-pick'; sel.setAttribute('aria-label', 'Group for ' + c.name);
  sel.innerHTML = groupOptions(groupsNow(), c.group || '', true);
  b.replaceWith(sel); sel.focus();
  let done = false, asking = false;
  const finish = (to) => { if (done) return; done = true; if (to !== null && to !== (c.group || '')) setGroup([c.key], to); else showGroup(c); };
  sel.addEventListener('change', async () => {
    if (sel.value !== '+') return finish(sel.value);
    asking = true;
    const name = await askNewGroup(sel, setGroups);
    finish(name || null);
  });
  sel.addEventListener('blur', () => { if (!asking) finish(null); });
  sel.addEventListener('keydown', k => { if (k.key === 'Escape') { k.stopPropagation(); finish(null); } });
});
$('pick-group').addEventListener('change', async () => {
  const box = $('pick-group'), v = box.value; if (!v) return;
  const name = v === '+' ? await askNewGroup(box, setGroups) : v === '-' ? '' : v;
  if (v === '+' && !name) { box.value = ''; return; }
  setGroup([...picked], name);
});
async function setGroup(keys, group) {
  const list = keys.map(k => data.customers[k]).filter(Boolean), was = list.map(c => [c, c.group || '']);
  list.forEach(c => { c.group = group; showGroup(c); const tr = rowOf(c.key); if (tr) tr.classList.add('saving'); });
  $('save-msg').textContent = 'Saving ' + (list.length === 1 ? list[0].name : list.length.toLocaleString() + ' customers') + '…';
  try {
    const out = await saveStep('setGroup', { keys: list.map(c => c.key), group });
    Object.assign(data.customers, out.customers || {});
    if (keys.length > 1) { keys.forEach(k => setPicked(k, false)); }
    showError(''); $('save-msg').textContent = out.message;
  } catch (err) {
    was.forEach(([c, before]) => { c.group = before; });
    showError(serverText(err, 'the customer list')); $('save-msg').textContent = '';
  }
  list.forEach(c => { const now = data.customers[c.key] || c; showGroup(now); const tr = rowOf(c.key); if (tr) tr.classList.remove('saving'); });
  drawPicked();
  if (order.some(([i]) => i === GROUP)) draw();
}

function setData(d) {
  data = Object.assign({}, data || {}, d);
  $('not-admin').hidden = !!data.canImport; $('master-view').hidden = !data.canImport;
  drawStats(); drawLocations(); draw();
}

/* ---------- picking rows: click, Shift-click a run, drag down the list ---------- */
const rowOf = (key) => $('rows').querySelector('tr[data-key="' + CSS.escape(key) + '"]');
function setPicked(key, on) { if (on) picked.add(key); else picked.delete(key); const tr = rowOf(key); if (tr) tr.classList.toggle('picked', on); }
function pickRun(from, to, on) {
  const keys = rowsNow.slice(0, shown).map(c => c.key), a = keys.indexOf(from), b = keys.indexOf(to);
  if (a < 0 || b < 0) return setPicked(to, on);
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) setPicked(keys[i], on);
}
let drag = null;
$('rows').addEventListener('mousedown', ev => {
  const tr = ev.target.closest('tr[data-key]');
  if (!tr || ev.button !== 0 || ev.target.closest('a, button, select')) return;
  ev.preventDefault();                                                   // no text gets highlighted while dragging
  const key = tr.dataset.key, on = !picked.has(key);
  if (ev.shiftKey && anchor) pickRun(anchor, key, true); else setPicked(key, on);
  drag = { from: key, on: ev.shiftKey ? true : on };
  if (!ev.shiftKey) anchor = key;
  drawPicked();
});
$('rows').addEventListener('mouseover', ev => {
  if (!drag) return;
  const tr = ev.target.closest('tr[data-key]');
  if (tr) { pickRun(drag.from, tr.dataset.key, drag.on); drawPicked(); }
});
document.addEventListener('mouseup', () => { drag = null; });
$('thead').addEventListener('click', ev => {
  if (ev.target.closest('#pick-all')) {
    const allIn = rowsNow.length && rowsNow.every(c => picked.has(c.key));
    rowsNow.forEach(c => { if (allIn) picked.delete(c.key); else picked.add(c.key); });
    $('rows').querySelectorAll('tr[data-key]').forEach(tr => tr.classList.toggle('picked', picked.has(tr.dataset.key)));
    return drawPicked();
  }
  const b = ev.target.closest('button.sorter'); if (!b) return;
  const i = Number(b.dataset.col), was = order[0];
  order = [[i, was[0] === i ? -was[1] : 1]].concat(i === NAME ? [] : [[NAME, 1]]);
  $('sort').value = ''; shown = PAGE; remember(); draw();
});
$('pick-clear').onclick = () => { picked.clear(); anchor = null; $('rows').querySelectorAll('tr.picked').forEach(tr => tr.classList.remove('picked')); drawPicked(); };
$('pick-off').onclick = () => setStatus([...picked], true);
$('pick-on').onclick = () => setStatus([...picked], false);
// Double-click a status to switch it; double-click anywhere else on a line to open the customer's card (Joe 11/3: edit it).
$('rows').addEventListener('dblclick', ev => {
  const b = ev.target.closest('button.st');
  if (b) { const c = data.customers[b.dataset.key]; if (c) setStatus([c.key], !c.inactive); return; }
  if (ev.target.closest('a, button, select, input')) return;
  const tr = ev.target.closest('tr[data-key]'); if (tr) { setPicked(tr.dataset.key, false); drawPicked(); editCustomer(tr.dataset.key); }
});
$('pick-edit').onclick = () => editCustomer([...picked][0]);

/* ---------- a customer's card: every box, the account number too (udcl-card.js) ---------- */
function editCustomer(key) {
  const c = data.customers[key]; if (!c) return;
  const on = (data.routeDays || []).filter(rd => (rd.stops || []).some(s => s.key === key)).map(rd => 'Route ' + rd.route + ' ' + (U.DAY_NAMES[rd.day] || rd.day));
  openCard({ data, key, routesHtml: on.length ? on.map(e).join('<br>') : 'Not on any route day', onGroups: setGroups, onSaved: (cust, oldKey, out) => {
    (out.routeDays || []).forEach(rd => { const i = (data.routeDays || []).findIndex(x => x.route === rd.route && x.day === rd.day); if (i >= 0) data.routeDays[i] = rd; });
    if (oldKey && oldKey !== cust.key) {
      if (picked.delete(oldKey)) picked.add(cust.key);
      rowsNow = rowsNow.map(x => (x.key === oldKey ? cust : x));
    } else rowsNow = rowsNow.map(x => (x.key === cust.key ? cust : x));
    const tr = rowOf(oldKey || cust.key);
    if (tr) tr.outerHTML = rowHtml(cust);
    drawStats(); drawPicked();
  } });
}

/* ---------- Active / Inactive: shown at once, saved in one call, only those lines redrawn ---------- */
function showStatus(c, saving) {
  const tr = rowOf(c.key); if (!tr) return;
  tr.classList.toggle('is-inactive', !!c.inactive); tr.classList.toggle('saving', !!saving);
  tr.cells[1].innerHTML = statusCell(c);
}
const redrawAll = () => $('status').value || order.some(([i]) => i === 0);   // the line moves or leaves the list
async function setStatus(keys, inactive, quiet) {
  const list = keys.map(k => data.customers[k]).filter(c => c && !!c.inactive !== inactive);
  if (!list.length) { if (keys.length > 1) { keys.forEach(k => setPicked(k, false)); drawPicked(); } $('save-msg').textContent = (keys.length === 1 ? 'That customer is' : 'Those customers are') + ' already ' + (inactive ? 'inactive' : 'active') + '.'; return; }
  if (inactive && !quiet) {
    const going = new Set(list.map(c => c.key));
    const on = (data.routeDays || []).filter(rd => (rd.stops || []).some(s => going.has(s.key))).map(rd => 'route ' + rd.route + ' ' + (U.DAY_NAMES[rd.day] || rd.day));
    const who = list.length === 1 ? list[0].name + ' is' : 'Some of these ' + list.length + ' customers are';
    if (on.length && !window.confirm(who + ' on ' + (on.length > 6 ? on.slice(0, 6).join(', ') + ' and ' + (on.length - 6) + ' more' : on.join(', ')) + '. Making ' + (list.length === 1 ? 'it' : 'them') + ' inactive takes ' + (list.length === 1 ? 'it' : 'them') + ' off ' + (on.length === 1 ? 'that route day' : 'those route days') + '. Go ahead?')) return;
  }
  const was = list.map(c => [c, !!c.inactive]);
  list.forEach(c => { c.inactive = inactive; showStatus(c, true); });
  if (redrawAll()) draw(); else { drawCount(); }
  $('save-msg').textContent = 'Saving ' + (list.length === 1 ? list[0].name : list.length.toLocaleString() + ' customers') + '…';
  try {
    const out = await saveStep('setStatus', { keys: list.map(c => c.key), inactive });
    Object.assign(data.customers, out.customers || {});
    (out.routeDays || []).forEach(rd => { const i = (data.routeDays || []).findIndex(x => x.route === rd.route && x.day === rd.day); if (i >= 0) data.routeDays[i] = rd; });
    list.forEach(c => showStatus(data.customers[c.key] || c, false));
    if (keys.length > 1) { keys.forEach(k => setPicked(k, false)); drawPicked(); }
    showError(''); $('save-msg').textContent = out.message;
  } catch (err) {
    was.forEach(([c, before]) => { c.inactive = before; showStatus(c, false); });
    showError(serverText(err, 'the customer list')); $('save-msg').textContent = '';
  }
  if (redrawAll()) draw(); else drawCount();
  drawStats();
}

/* ---------- the upload box ---------- */
const say = (t, cls) => { $('i-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
const box = $('upload-box');
function openUpload() { if (!$('i-addr-go').disabled) { say(''); $('i-addr').value = ''; } box.hidden = false; $('i-addr').focus(); }
function closeUpload() { box.hidden = true; $('upload-open').focus(); }
$('upload-open').onclick = openUpload;
$('upload-close').onclick = closeUpload;
box.addEventListener('click', ev => { if (ev.target === box) closeUpload(); });
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (!box.hidden) closeUpload(); else if (picked.size) $('pick-clear').click();
});
async function upload() {
  const file = $('i-addr').files[0];
  if (!file) return say('Pick the master list file first.', 'bad');
  $('i-addr-go').disabled = true;
  try {
    say('Reading ' + file.name + '…');
    const X = await loadXlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array' });
    let full = [];
    wb.SheetNames.some(n => (full = U.fullListRows(sheetRows(X, wb, n))).length);
    if (full.length) {
      say('Saving ' + full.length.toLocaleString() + ' customers from the master list. This can take a minute…');
      const out = await saveStep('importFullList', { rows: full, fileName: file.name, thenView: true, all: true });
      setData(out); $('save-msg').textContent = out.message; return say(out.message, 'good');
    }
    let rows = [];
    wb.SheetNames.some(n => (rows = U.checkedAddressRows(sheetRows(X, wb, n))).length);
    if (!rows.length) return say('No sheet with DC, Account and Customer headings (the master list) or Account, Street and City headings (checked addresses) was found in ' + file.name + '.', 'bad');
    say('Saving ' + rows.length + ' checked addresses…');
    const out = await saveStep('importAddresses', { rows, fileName: file.name, thenView: true, all: true });
    setData(out); say(out.message, 'good'); $('save-msg').textContent = out.message;
  } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  finally { $('i-addr-go').disabled = false; }
}
$('i-addr-go').onclick = upload;

/* ---------- the boxes ---------- */
$('sort').addEventListener('change', () => { if (PRESETS[$('sort').value]) { order = PRESETS[$('sort').value]; shown = PAGE; remember(); draw(); } });
// The boxes that do not wait for the list take the remembered view at once (the location box is filled with the list).
if (saved.sort === '' || PRESETS[saved.sort]) $('sort').value = saved.sort;
if ([...$('status').options].some(o => o.value === saved.status)) $('status').value = saved.status;
let typing = null;
['q', 'dcpick', 'status'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { shown = PAGE; clearTimeout(typing); if (id === 'q') typing = setTimeout(draw, 200); else { remember(); draw(); } }));
$('rows').addEventListener('click', ev => { const m = ev.target.closest('button[data-more]'); if (m) { shown = m.dataset.more === 'all' ? Infinity : shown + PAGE; draw(); } });
printMenu($('udcl-print-menu'), () => !data ? [] : [{ label: 'This list, as shown', note: 'In this order, with the boxes as they are', html: () => printDoc('Master customer list',
  [tablePage('Master customer list · ' + data.plantName, $('count').textContent, shownRows(), COLS.map(c => [c[0], c[1], c[2]]))]) }]);

requireSignIn(async () => {
  try {
    let d = await readList({ all: true }), ruled = '';
    // Joe 11/3, once: Uniontown customers on no route go inactive, and route customers the master list had under another DC become
    // Uniontown's (applyRouteRule). Done before the list is drawn, so the screen shows once, already right.
    if (d.canImport && !d.routeRule && (d.routeDays || []).length && d.plant === 'fac_uniontown') {
      ruled = (await saveStep('applyRouteRule', {})).message;
      d = await readList({ all: true });
    }
    setData(d); showError('');
    if (ruled) $('save-msg').textContent = ruled;
    // Joe 11/3: a name that starts with "..." is an inactive customer. Any still active from before that rule are switched now.
    const dotted = Object.values(data.customers).filter(c => !c.inactive && U.inactiveName(c.name)).map(c => c.key);
    if (dotted.length) await setStatus(dotted, true, true);
  } catch (err) { showError(serverText(err, 'the customer list')); }
});
