// The Master Customer List (Joe 11/2, in Administration): "basically a master customer list. It will show all of them", every
// distribution center, with Active or Inactive first ("If it is inactive, then it's not showing anywhere else in our system"),
// a Sort by box (location, then A to Z) and a sort on every heading. The master address file is uploaded here.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { readList, saveStep, printMenu, printDoc, tablePage, U } from './udcl.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const el = document.createElement('script'); el.src = XLSX_URL; el.onload = () => ok(window.XLSX); el.onerror = () => bad(new Error('Could not load the Excel reader. Check the network and try again.')); document.head.appendChild(el); });
const sheetRows = (X, wb, name) => { const ws = wb.Sheets[name]; return ws ? X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) : null; };
const $ = (id) => document.getElementById(id);
let data = null;

const fixed = (v) => v ? Number(v).toFixed(6) : '';
const dcLabel = (v) => { const d = U.dcOf(v); return d ? U.dcName(d).replace(/ DC \d+$/, '') : ''; };
const statusOf = (c) => c.inactive ? 'Inactive' : 'Active';
// [heading, value, centred, width, cut long text]
const COLS = [['Status', statusOf, 1, '6.5%'], ['DC', c => dcLabel(c.dc), 0, '6%'], ['Chain', c => c.chain, 1, '3.5%'], ['Account', c => c.account, 1, '5%'], ['Customer', c => c.name, 0, '12%', 1],
  ['Street', c => c.address, 0, '11%', 1], ['Second line', c => c.address2, 0, '5%', 1], ['City', c => c.city, 0, '7%', 1], ['State', c => c.state, 1, '3%'], ['ZIP', c => c.zip, 1, '5.5%'],
  ['Latitude', c => c.lat && c.lon ? fixed(c.lat) : '', 1, '5.5%'], ['Longitude', c => c.lat && c.lon ? fixed(c.lon) : '', 1, '5.5%'], ['Phone', c => c.phone, 0, '6.5%', 1], ['Group', c => c.group || '', 0, '6%', 1],
  ['Match status', c => c.addressCheck || '', 0, '', 1], ['Coordinate source', c => c.gpsFrom || '', 0, '6%', 1]];
const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// The Sort by box: each is a list of [column, direction]. A heading pressed sorts by it (again: the other way).
const PRESETS = { location: [[1, 1], [4, 1]], name: [[4, 1]], city: [[7, 1], [4, 1]], status: [[0, -1], [1, 1], [4, 1]] };
const DC_NUM = (c) => Number(U.dcOf(c.dc)) || 99999;
let order = PRESETS.location, shown = 300;
const PAGE = 300;

function shownRows() {
  const words = U.text($('q').value).toUpperCase().split(' ').filter(Boolean), dc = $('dcpick').value, st = $('status').value;
  const rows = Object.values(data.customers).filter(c => (!dc || U.dcOf(c.dc) === dc) && (!st || statusOf(c) === st) &&
    (!words.length || (() => { const t = [c.name, c.account, c.chain, c.city, c.address, c.zip, c.phone, c.group, dcLabel(c.dc)].join(' ').toUpperCase(); return words.every(w => t.indexOf(w) >= 0); })()));
  const keyOf = (i, c) => i === 1 ? DC_NUM(c) : COLS[i][1](c);
  rows.sort((a, b) => {
    for (const [i, dir] of order) {
      const x = keyOf(i, a), y = keyOf(i, b);
      if (x === y) continue;
      if (x === '' || x === null || x === undefined) return 1;          // blanks last, either way
      if (y === '' || y === null || y === undefined) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y));
      if (r) return r * dir;
    }
    return 0;
  });
  return rows;
}

function draw() {
  if (!data) return;
  const rows = shownRows(), head = order[0];
  $('thead').innerHTML = '<tr>' + COLS.map((c, i) => '<th' + (c[2] ? '' : ' class="l"') + (c[3] ? ' style="width:' + c[3] + '"' : '') + '><button type="button" class="sorter" data-col="' + i + '"' +
    (head[0] === i ? ' aria-sort="' + (head[1] > 0 ? 'ascending' : 'descending') + '"' : '') + ' title="Sort by ' + e(c[0]) + '">' + e(c[0]) + '<span class="arrow">' + (head[0] === i ? (head[1] > 0 ? ' &#9650;' : ' &#9660;') : '') + '</span></button></th>').join('') + '</tr>';
  $('rows').innerHTML = rows.slice(0, shown).map(c => '<tr class="' + (c.inactive ? 'is-inactive' : '') + '" data-key="' + e(c.key) + '">' + COLS.map((col, i) => {
    const v = col[1](c);
    if (i === 0) return '<td>' + (data.canImport ? '<select class="status ' + (c.inactive ? 'off' : 'on') + '" data-key="' + e(c.key) + '" aria-label="Active or inactive: ' + e(c.name) + '"><option' + (c.inactive ? '' : ' selected') + '>Active</option><option' + (c.inactive ? ' selected' : '') + '>Inactive</option></select>' : e(v)) + '</td>';
    if (col[0] === 'Latitude' && v !== '') return '<td><a href="https://www.google.com/maps?q=' + encodeURIComponent(c.lat + ',' + c.lon) + '" target="_blank" rel="noopener" title="Open in Google Maps">' + e(v) + '</a></td>';
    return '<td' + (col[2] ? '' : ' class="l"') + (col[4] ? ' title="' + e(v) + '"' : '') + '>' + (col[0] === 'Customer' ? '<b>' + e(v) + '</b>' : col[0] === 'Street' && !v ? '<span class="warnline">No address yet</span>' : e(v)) + '</td>';
  }).join('') + '</tr>').join('') + (rows.length > shown ? '<tr class="more"><td colspan="' + COLS.length + '">Showing ' + shown.toLocaleString() + ' of ' + rows.length.toLocaleString() +
    ' &nbsp; <button type="button" data-more="1">Show ' + Math.min(PAGE, rows.length - shown) + ' more</button> <button type="button" data-more="all">Show all</button></td></tr>' : '') ||
    '<tr><td colspan="' + COLS.length + '" class="empty">' + (Object.keys(data.customers).length ? 'No customer matches these boxes.' : 'No customers yet. Upload the master address list above.') + '</td></tr>';
  const off = rows.filter(c => c.inactive).length;
  $('count').textContent = rows.length.toLocaleString() + ' customer' + (rows.length === 1 ? '' : 's') + (off ? ' · ' + off.toLocaleString() + ' inactive' : '');
}

function drawCard() {
  const all = Object.values(data.customers), n = (fn) => all.filter(fn).length;
  const stat = (num, label, warn) => '<span class="ml-stat' + (warn && num ? ' warn' : '') + '"><b>' + num.toLocaleString() + '</b> ' + e(label) + '</span>';
  const last = (m, what) => m ? '<span>Last ' + what + ': <b>' + e(m.fileName || 'a file') + '</b>, ' + e(shortDate(m.at)) + ' by ' + e(m.by) + '</span>' : '';
  $('card-stats').innerHTML = stat(all.length, 'customers') + stat(n(c => !c.inactive), 'active') + stat(n(c => c.inactive), 'inactive') + stat(n(c => c.lat && c.lon), 'with GPS') +
    stat(n(c => c.phone), 'with a phone') + stat(n(c => !U.addressLine(c)), 'with no address yet', true);
  $('card-last').innerHTML = [last(data.master, 'master list'), last(data.addressSheet, 'checked addresses')].filter(Boolean).join(' · ');
  const dcs = [...new Set(all.map(c => U.dcOf(c.dc)).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const keep = $('dcpick').value;
  $('dcpick').innerHTML = '<option value="">All locations</option>' + dcs.map(d => '<option value="' + e(d) + '">' + e(d + ' ' + (dcLabel(d).replace(/^\d+\s*/, '') || '')) + '</option>').join('');
  $('dcpick').value = dcs.includes(keep) ? keep : '';
}

function setData(d) {
  data = Object.assign({}, data || {}, d);
  $('plant-name').textContent = data.plantName || '';
  $('not-admin').hidden = !!data.canImport; $('master-view').hidden = !data.canImport;
  drawCard(); draw();
}

const say = (t, cls) => { $('i-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
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
      setData(out); return say(out.message, 'good');
    }
    let rows = [];
    wb.SheetNames.some(n => (rows = U.checkedAddressRows(sheetRows(X, wb, n))).length);
    if (!rows.length) return say('No sheet with DC, Account and Customer headings (the master list) or Account, Street and City headings (checked addresses) was found in ' + file.name + '.', 'bad');
    say('Saving ' + rows.length + ' checked addresses…');
    const out = await saveStep('importAddresses', { rows, fileName: file.name, thenView: true, all: true });
    setData(out); say(out.message, 'good');
  } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
  finally { $('i-addr-go').disabled = false; }
}

$('i-addr-go').onclick = upload;
$('sort').addEventListener('change', () => { if (PRESETS[$('sort').value]) { order = PRESETS[$('sort').value]; shown = PAGE; draw(); } });
let typing = null;
['q', 'dcpick', 'status'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', () => { shown = PAGE; clearTimeout(typing); if (id === 'q') typing = setTimeout(draw, 200); else draw(); }));
$('thead').addEventListener('click', ev => {
  const b = ev.target.closest('button.sorter'); if (!b) return;
  const i = Number(b.dataset.col), was = order[0];
  order = [[i, was[0] === i ? -was[1] : 1]].concat(i === 4 ? [] : [[4, 1]]);
  $('sort').value = ''; shown = PAGE; draw();
});
$('rows').addEventListener('click', ev => { const m = ev.target.closest('button[data-more]'); if (m) { shown = m.dataset.more === 'all' ? Infinity : shown + PAGE; draw(); } });
$('rows').addEventListener('change', async ev => {
  const sel = ev.target.closest('select.status'); if (!sel) return;
  const c = data.customers[sel.dataset.key], inactive = sel.value === 'Inactive';
  if (inactive) {
    const on = (data.routeDays || []).filter(rd => (rd.stops || []).some(s => s.key === c.key)).map(rd => 'route ' + rd.route + ' ' + (U.DAY_NAMES[rd.day] || rd.day));
    if (on.length && !window.confirm(c.name + ' is on ' + on.join(', ') + '. Making it inactive takes it off ' + (on.length === 1 ? 'that route day' : 'those route days') + '. Go ahead?')) { sel.value = 'Active'; return; }
  }
  sel.disabled = true;
  try {
    const out = await saveStep('setActive', { key: c.key, inactive, thenView: true, all: true });
    setData(out); showError(''); $('save-msg').textContent = out.message;
  } catch (err) { showError(serverText(err, 'the customer list')); draw(); }
});
printMenu($('udcl-print-menu'), () => !data ? [] : [{ label: 'This list, as shown', note: 'In this order, with the boxes as they are', html: () => printDoc('Master customer list',
  [tablePage('Master customer list · ' + data.plantName, $('count').textContent, shownRows(), COLS.filter(c => !/Coordinate|Second/.test(c[0])).map(c => [c[0], c[1], c[2]]))]) }]);

requireSignIn(async () => {
  try { setData(await readList({ all: true })); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
