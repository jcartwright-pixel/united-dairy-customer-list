// Route Sequence (United Dairy Customer List, Joe 11/1): one route on one day, its stops in the order the driver runs them. An
// Administrator or Manager drags a stop to a new place (or uses the arrows), changes its load sequence and note, adds a stop, edits
// one (its days, its route, its notes, or takes it off: Joe 11/2), and types the start time and instructions; every change saves
// by itself. Load Map opens the truck in its own window; a change in either window shows in the other. The Print menu prints it for the office, as a
// driver's route book page, or every day of the route / every route of the day.
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { mountRowDrag } from './row-drag.js';
import { readList, saveStep, printMenu, printDoc, routeDayPage, loadMapPage, truckHtml, sortedRouteDays, routesOf, todayKey, followLoadSeq, announceChange, onChange, U } from './udcl.js';

const params = new URLSearchParams(location.search);
let data = null, route = params.get('route') || '', day = U.dayOf(params.get('day')) || '';
const $ = (id) => document.getElementById(id);
const rdOf = (r, d) => (data ? data.routeDays : []).find(x => x.route === r && x.day === d) || null;
const current = () => rdOf(route, day);
let saving = Promise.resolve();

function pickDefaults() {
  const routes = routesOf(data.routeDays);
  if (!routes.includes(route)) route = routes[0] || '';
  const days = data.routeDays.filter(x => x.route === route).map(x => x.day);
  if (!days.includes(day)) day = days.includes(todayKey()) ? todayKey() : days.sort((a, b) => U.dayIndex(a) - U.dayIndex(b))[0] || '';
  history.replaceState(null, '', '?route=' + encodeURIComponent(route) + '&day=' + day);
}

function draw() {
  if (!data) return;
  pickDefaults();
  const routes = routesOf(data.routeDays);
  $('route').innerHTML = routes.map(r => '<option value="' + e(r) + '"' + (r === route ? ' selected' : '') + '>Route ' + e(r) + '</option>').join('') || '<option value="">No routes yet</option>';
  $('days').innerHTML = U.DAYS.map(d => '<button type="button" data-day="' + d + '" aria-pressed="' + (d === day) + '"' + (rdOf(route, d) ? '' : ' disabled') + '>' + U.DAY_NAMES[d].slice(0, 3) + '</button>').join('');
  const rd = current(), edit = data.canEdit;
  const stops = rd ? rd.stops || [] : [];
  $('rows').innerHTML = stops.map((s, i) => {
    const c = data.customers[s.key] || {};
    return '<tr data-drag="' + e(s.key) + '"><td><span class="stopno">' + (i + 1) + '</span></td>' +
      '<td>' + (edit ? '<input class="seq" data-i="' + i + '" inputmode="numeric" value="' + (s.loadSeq || '') + '" aria-label="Load sequence for ' + e(c.name || s.name) + '">' : (s.loadSeq || '-')) + '</td>' +
      '<td>' + e(c.account || s.account) + '</td><td class="l"><b>' + e(c.name || s.name) + '</b>' + (c.city ? ' <small>' + e(c.city) + '</small>' : '') + '</td>' +
      '<td class="l">' + (edit ? '<input class="note" data-i="' + i + '" value="' + e(s.note || '') + '" placeholder="Note for this stop">' : e(s.note || '')) + '</td>' +
      '<td>' + (edit ? '<button type="button" class="mv" data-up="' + i + '" title="Move up"' + (i ? '' : ' disabled') + '>&#9650;</button> <button type="button" class="mv" data-down="' + i + '" title="Move down"' + (i < stops.length - 1 ? '' : ' disabled') + '>&#9660;</button> <button type="button" class="ed" data-ed="' + i + '">Edit</button>' : '') + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">' + (data.routeDays.length ? 'No stops on this route day.' : 'The customer list is empty. An administrator imports it on the Customers screen.') + '</td></tr>';
  $('start').value = rd ? rd.startTime || '' : ''; $('notes').value = rd ? rd.notes || '' : '';
  $('start').disabled = $('notes').disabled = !edit || !rd;
  $('map').innerHTML = rd ? truckHtml(rd.map, { style: '--lm-w:30px;--lm-h:20px;--lm-f:12px' }) : '';
  $('map-link').href = 'load-map.html?route=' + encodeURIComponent(route) + '&day=' + day;
  $('changed').textContent = rd && rd.updatedAt ? 'Last changed ' + shortDate(rd.updatedAt) + ' by ' + (rd.updatedBy || '') : '';
  $('add-box').hidden = !edit || !rd;
  if (edit && rd) {
    const on = new Set(stops.map(s => s.key));
    const others = Object.values(data.customers).filter(c => !on.has(c.key) && c.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    $('add-pick').innerHTML = '<option value="">Pick a customer to add at the end&hellip;</option>' + others.map(c => '<option value="' + e(c.key) + '">' + e(c.name) + (c.account ? ' (' + e(c.account) + ')' : '') + '</option>').join('');
  }
  const missing = stops.filter(s => !s.loadSeq).length;
  $('hint').textContent = (edit ? 'Drag a stop up or down (or use the arrows) to change the run order. Every change saves by itself. ' : 'Only an Administrator or Manager can change the sequence. ') +
    (missing ? missing + ' stop' + (missing === 1 ? ' has' : 's have') + ' no load sequence.' : '');
}

/** Saves the route day (the whole stop list in its new order, or the start time / instructions) and shows what the server kept. */
function save(fields) {
  const first = current();
  if (!first) return;
  const r = first.route, d = first.day;
  saving = saving.then(async () => {
    // The newest copy (an earlier save in the queue may have moved its rev on).
    const rd = rdOf(r, d) || first;
    try {
      const out = await saveStep('saveRouteDay', Object.assign({ route: r, day: d, rev: rd.rev }, fields));
      const i = data.routeDays.indexOf(rd);
      if (i >= 0) data.routeDays[i] = out.routeDay;
      announceChange(r, d);
      showError('');
    } catch (err) {
      showError(serverText(err, 'the customer list'));
      try { data = Object.assign(data, await readList()); } catch (e2) { /* keep what is shown */ }
    }
    draw();
  });
  return saving;
}
const stopsNow = () => (current().stops || []).map(s => ({ key: s.key, loadSeq: s.loadSeq, note: s.note || '' }));
function moveStop(from, to) {
  const list = stopsNow();
  if (to < 0 || to >= list.length || from === to) return;
  const [s] = list.splice(from, 1);
  list.splice(to, 0, s);
  // Shown at once, saved behind.
  const rd = current(), old = rd.stops.slice(), [o] = old.splice(from, 1);
  old.splice(to, 0, o); rd.stops = old; draw();
  save({ stops: list });
}

$('route').onchange = () => { route = $('route').value; day = ''; draw(); };
$('days').onclick = (ev) => { const b = ev.target.closest('button[data-day]'); if (b && !b.disabled) { day = b.dataset.day; draw(); } };
$('rows').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.up !== undefined) moveStop(Number(b.dataset.up), Number(b.dataset.up) - 1);
  else if (b.dataset.down !== undefined) moveStop(Number(b.dataset.down), Number(b.dataset.down) + 1);
  else if (b.dataset.ed !== undefined) openEdit(Number(b.dataset.ed));
});
$('rows').addEventListener('change', ev => {
  const el = ev.target, i = Number(el.dataset.i);
  if (!el.matches('input.seq, input.note')) return;
  const list = stopsNow();
  if (el.matches('.note')) { list[i].note = el.value; return save({ stops: list }); }
  // The truck load map follows the new load sequence (the same as on Truck Load Map).
  const was = list[i].loadSeq, rd = current();
  list[i].loadSeq = U.seqOf(el.value);
  const map = followLoadSeq(rd.map || U.autoMap(rd.stops || []), list, i, was, list[i].loadSeq);
  save(Object.assign({ stops: list }, map ? { map } : {}));
});
$('add-pick').onchange = () => { const k = $('add-pick').value; if (!k) return; const list = stopsNow(); list.push({ key: k, loadSeq: 0, note: '' }); save({ stops: list }); };
$('start').onchange = () => save({ startTime: $('start').value });
$('notes').onchange = () => save({ notes: $('notes').value });
mountRowDrag({ box: $('rows'), canDrag: () => !!(data && data.canEdit), onMove: (key, to) => { const from = (current().stops || []).findIndex(s => s.key === key); moveStop(from, to); } });

/* ---------- Edit a stop (Joe 11/2: "instead of the remove, I want edit ... move the day, add a day, move it to a different route ... and
   then I would just like to have a notes in on the right side") ---------- */
function closeEdit() { const m = $('edit'); if (m) m.remove(); window.udclBack = null; }
function openEdit(i) {
  const rd = current(), s = rd && rd.stops[i];
  if (!s) return;
  const c = data.customers[s.key] || {}, name = c.name || s.name;
  const daysOn = (r) => U.DAYS.filter(d => { const x = rdOf(r, d); return x && (x.stops || []).some(t => t.key === s.key); });
  closeEdit();
  const m = document.createElement('div');
  m.id = 'edit'; m.className = 'udcl-modal';
  m.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="ed-title"><header><h2 id="ed-title">' + e(name) + (c.account ? ' <small>#' + e(c.account) + '</small>' : '') + '</h2><button type="button" id="ed-close">Close</button></header>' +
    '<div class="cols"><div class="left">' +
      '<label>Route<select id="ed-route">' + routesOf(data.routeDays).map(r => '<option value="' + e(r) + '"' + (r === route ? ' selected' : '') + '>Route ' + e(r) + '</option>').join('') + '</select></label>' +
      '<div class="lbl">Delivery days on this route<small>Tick a day to add the stop, untick to take it off that day.</small></div><div class="ed-days" id="ed-days"></div>' +
      '<p class="ed-what" id="ed-what"></p>' +
      '<button type="button" class="danger" id="ed-off">Take off route ' + e(route) + ' (every day)</button>' +
    '</div><div class="right">' +
      '<label>Note for this stop<small>Route ' + e(route) + ', ' + U.DAY_NAMES[day] + ' only</small><textarea id="ed-note" maxlength="' + U.LIMITS.note + '">' + e(s.note || '') + '</textarea></label>' +
      '<label>Notes for the driver<small>On every day and route (the customer\'s card)</small><textarea id="ed-cnotes" maxlength="' + U.LIMITS.notes + '">' + e(c.notes || '') + '</textarea></label>' +
    '</div></div><footer><span id="ed-msg"></span><button type="button" id="ed-cancel">Cancel</button><button type="button" class="primary" id="ed-save">Save</button></footer></div>';
  document.body.appendChild(m);
  let picked = new Set(daysOn(route));
  const drawDays = () => {
    const r = $('ed-route').value;
    $('ed-days').innerHTML = U.DAYS.map(d => '<label class="ed-day"><input type="checkbox" value="' + d + '"' + (picked.has(d) ? ' checked' : '') + '>' + U.DAY_NAMES[d].slice(0, 3) + '</label>').join('');
    const off = daysOn(route).filter(d => r !== route || !picked.has(d)), on = [...picked].filter(d => !rdOf(r, d) || !(rdOf(r, d).stops || []).some(t => t.key === s.key));
    const say = [];
    if (r !== route) say.push('Moves to route ' + r + '.');
    if (off.length) say.push('Comes off route ' + route + ' on ' + off.map(d => U.DAY_NAMES[d]).join(', ') + '.');
    if (on.length) say.push('Goes on route ' + r + ' on ' + on.map(d => U.DAY_NAMES[d]).join(', ') + ' (placed by its load sequence, ' + (s.loadSeq || 'none') + ').');
    $('ed-what').textContent = say.join(' ');
  };
  // A different route starts with the same days ticked, so "move to route 805" keeps the days.
  $('ed-route').onchange = () => { if ($('ed-route').value === route) picked = new Set(daysOn(route)); drawDays(); };
  $('ed-days').onchange = (ev) => { const b = ev.target; if (b.checked) picked.add(b.value); else picked.delete(b.value); drawDays(); };
  drawDays();
  const msg = (t, bad) => { $('ed-msg').textContent = t || ''; $('ed-msg').className = bad ? 'bad' : ''; };
  const apply = async (days) => {
    const r = $('ed-route').value, note = $('ed-note').value.trim(), cnotes = $('ed-cnotes').value.trim();
    const moved = r !== route || U.DAYS.some(d => picked.has(d) !== daysOn(route).includes(d)) || days;
    msg('Saving…');
    await saving;
    try {
      if (moved) {
        const out = await saveStep('placeStop', { key: s.key, from: route, route: r, day, days: days || [...picked], note });
        out.changed.forEach(x => { const k = data.routeDays.findIndex(y => y.route === x.route && y.day === x.day); if (k >= 0) data.routeDays[k] = x; else data.routeDays.push(x); });
      } else if (note !== (s.note || '')) {
        const list = stopsNow(); list[i].note = note;
        const out = await saveStep('saveRouteDay', { route, day, rev: current().rev, stops: list });
        data.routeDays[data.routeDays.indexOf(current())] = out.routeDay;
      }
      if (cnotes !== (c.notes || '')) { const out = await saveStep('saveCustomer', { key: s.key, fields: { notes: cnotes } }); data.customers[s.key] = out.customer; }
      announceChange(route, day);
      closeEdit(); draw(); showError('');
    } catch (err) { msg(serverText(err, 'the customer list'), true); }
  };
  $('ed-save').onclick = () => apply(null);
  $('ed-off').onclick = () => {
    const b = $('ed-off');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Press again to take ' + name + ' off route ' + route; return; }
    $('ed-route').value = route; apply([]);
  };
  $('ed-close').onclick = $('ed-cancel').onclick = closeEdit;
  m.onclick = (ev) => { if (ev.target === m) closeEdit(); };
  window.udclBack = () => { if ($('edit')) { closeEdit(); return true; } return false; };
  $('ed-note').focus();
}
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('edit')) closeEdit(); });

/* ---------- the Load Map window (Joe 11/2: "an action button up there for the route map ... a whole other window ... just the customer,
   load sequence ... And I edit there, it would change this window") ---------- */
$('open-map').onclick = () => { const w = window.open('load-map.html?window=1&route=' + encodeURIComponent(route) + '&day=' + day, 'udcl-load-map', 'width=1180,height=860'); if (w) w.focus(); };
// A change saved in another window (the Load Map window, another office computer's screen in this browser): read the list again.
async function reread() { if ($('edit')) return; try { const d = await readList(); data = d; draw(); } catch (err) { /* keep what is shown */ } }
onChange(() => { saving.then(reread); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') saving.then(reread); });

printMenu($('udcl-print-menu'), () => {
  if (!data) return [];
  const rd = current(), pn = data.plantName, all = sortedRouteDays(data.routeDays);
  const sameRoute = all.filter(x => x.route === route), sameDay = all.filter(x => x.day === day);
  return [
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' for the office', note: 'Stops in order with load sequence, address and notes', html: () => printDoc('Route ' + route, [routeDayPage(rd, data.customers, 'office', pn)]) },
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' driver route book page', note: 'With keys, time in / out, instructions and the load map', html: () => printDoc('Route book ' + route, [routeDayPage(rd, data.customers, 'driver', pn)]) },
    rd && { label: 'Route ' + route + ' ' + U.DAY_NAMES[day] + ' load map', note: 'The truck drawing and the customers beside it', html: () => printDoc('Load map ' + route, [loadMapPage(rd, data.customers, pn)]) },
    { label: 'Every day of route ' + route + ' (route book)', note: sameRoute.length + ' pages', html: () => printDoc('Route book ' + route, sameRoute.map(x => routeDayPage(x, data.customers, 'driver', pn))) },
    day && { label: 'Every route on ' + U.DAY_NAMES[day] + ' for the office', note: sameDay.length + ' pages', html: () => printDoc(U.DAY_NAMES[day], sameDay.map(x => routeDayPage(x, data.customers, 'office', pn))) },
    { label: 'The whole route book (every route, every day)', note: all.length + ' pages', html: () => printDoc('Route book', all.map(x => routeDayPage(x, data.customers, 'driver', pn))) }
  ];
});

requireSignIn(async () => {
  try { data = await readList(); $('plant-name').textContent = data.plantName || ''; draw(); showError(''); }
  catch (err) { showError(serverText(err, 'the customer list')); }
});
