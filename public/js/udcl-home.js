/*
 * Home (Joe 11-12-26: "Make this home screen a lot better ... more detail, maybe in the menu option like we have on the left").
 * The menu down the left side (every screen with what it is for), and on the right what the list holds today: the numbers, today's
 * routes, the week day by day, what is missing on customers, and the newest changes. Read only: nothing is changed from Home.
 */
import { requireSignIn, SCREENS, escapeHtml as e, showError, serverText, shortDate, installed, installApp, canInstall } from './shell.js';
import { readList, todayKey, U } from './udcl.js';

const $ = (id) => document.getElementById(id);
const ICONS = { 'index.html': 'house', 'master-customers.html': 'users', 'customers.html': 'route', 'route-sequence.html': 'list-checks', 'load-map.html': 'truck', 'administration.html': 'settings', 'help.html': 'circle-help' };
// Icons from the United Dairy look (brand/icons, Lucide), drawn in the colour of the words beside them.
const icon = (name) => { const u = 'url(img/icons/' + name + '.svg)'; return '<span class="ico" style="-webkit-mask-image:' + u + ';mask-image:' + u + '" aria-hidden="true"></span>'; };
const n = (v) => Number(v || 0).toLocaleString('en-US');
const routeLabel = (r) => 'Route ' + r;
const firstUp = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/* ---------- the menu on the left ---------- */
$('home-menu').innerHTML = SCREENS.map(s => '<a href="' + s.href + '"' + (s.admin ? ' class="admin-only"' : '') + (s.href === 'index.html' ? ' aria-current="page"' : '') + '>' +
  icon(ICONS[s.href] || 'arrow-right') + '<span><b>' + e(s.name) + '</b>' + (s.href === 'index.html' ? '' : '<small>' + e(firstUp(s.note.replace(/^Administrators only: /, ''))) + '</small>') + '</span></a>').join('') +
  '<a href="load-map.html?kiosk=1" class="admin-only">' + icon('eye') + '<span><b>Load Map Kiosk</b><small>See what the plant floor screen shows</small></span></a>';

// Joe 11/1: "want to downloadable app": Install opens the browser's own box (Chrome or Edge on a computer).
function showInstall() { $('install-box').hidden = installed() || !canInstall(); }
document.addEventListener('udcl-installable', showInstall);
$('install').onclick = async () => { await installApp(); showInstall(); };
showInstall();

/* ---------- what the list holds ---------- */
function draw(d) {
  $('plant-name').textContent = d.plantName || '';
  const customers = d.customers || {}, keys = Object.keys(customers);
  // Only active customers count on a route (Joe 11/2: an inactive one shows nowhere else).
  const days = (d.routeDays || []).map(rd => Object.assign({}, rd, { live: (rd.stops || []).filter(s => customers[s.key]) })).filter(rd => rd.live.length);
  const routed = new Set(), routes = new Set();
  let stops = 0;
  days.forEach(rd => { routes.add(String(rd.route)); stops += rd.live.length; rd.live.forEach(s => routed.add(s.key)); });

  if (!keys.length) {
    $('home-body').innerHTML = '<section class="hm-card"><h2>' + icon('download') + 'The list is empty</h2><p>An administrator brings in the Route Menu on <a href="customers.html">Routes</a>.</p></section>';
    return;
  }

  const tiles = [
    ['users', 'Active customers', n(keys.length), d.inactiveHidden ? n(d.inactiveHidden) + ' inactive not shown' : 'every one on the list'],
    ['map-pin', 'On a route', n(routed.size), n(keys.length - routed.size) + ' on no route'],
    ['route', 'Routes', n(routes.size), n(days.length) + ' route days'],
    ['truck', 'Stops a week', n(stops), days.length ? Math.round(stops / days.length) + ' a route day on average' : '']
  ];
  $('hm-tiles').innerHTML = tiles.map(([ic, label, big, small]) => '<div class="hm-tile">' + icon(ic) + '<span class="hm-label">' + e(label) + '</span><span class="hm-big">' + e(big) + '</span><span class="hm-small">' + e(small) + '</span></div>').join('');

  // Today's routes: each opens its Route Book.
  const today = todayKey(), todays = days.filter(rd => rd.day === today).sort((a, b) => U.byRoute(a.route, b.route));
  $('hm-today-title').innerHTML = icon('calendar') + 'Today, ' + e(U.DAY_NAMES[today]);
  $('hm-today').innerHTML = todays.length
    ? '<div class="hm-routes">' + todays.map(rd => '<a href="route-sequence.html?route=' + encodeURIComponent(rd.route) + '&amp;day=' + rd.day + '"><b>' + e(routeLabel(rd.route)) + '</b><span>' + n(rd.live.length) + ' stops' + (rd.startTime ? ' · starts <span class="nw">' + e(rd.startTime) + '</span>' : '') + '</span></a>').join('') + '</div>'
    : '<p class="hm-none">No routes run today.</p>';

  // The week, day by day.
  const byDay = U.DAYS.map(day => { const list = days.filter(rd => rd.day === day); return { day, routes: list.length, stops: list.reduce((t, rd) => t + rd.live.length, 0) }; });
  const most = Math.max(1, ...byDay.map(x => x.stops));
  $('hm-week').innerHTML = '<table class="hm-table"><thead><tr><th class="l">Day</th><th>Routes</th><th>Stops</th><th class="l bar-h"></th></tr></thead><tbody>' +
    byDay.map(x => '<tr' + (x.day === today ? ' class="today"' : '') + '><td class="l">' + e(U.DAY_NAMES[x.day]) + '</td><td>' + n(x.routes) + '</td><td>' + n(x.stops) + '</td><td class="l">' + (x.stops ? '<span class="hm-bar" style="width:' + Math.round(x.stops / most * 100) + '%"></span>' : '') + '</td></tr>').join('') +
    '</tbody></table>';

  // What is missing on the active customers (to fill in on Customers).
  const missing = [
    ['map-pin', 'No route', keys.length - routed.size, 'customers.html'],
    ['building-2', 'No street address', keys.filter(k => !String(customers[k].address || '').trim()).length, 'master-customers.html'],
    ['map-pin', 'No map point', keys.filter(k => !(Number(customers[k].lat) && Number(customers[k].lon))).length, 'master-customers.html'],
    ['phone', 'No phone', keys.filter(k => !String(customers[k].phone || '').trim()).length, 'master-customers.html']
  ];
  $('hm-missing').innerHTML = '<ul class="hm-list">' + missing.map(([ic, label, count, href]) => '<li>' + icon(ic) + '<span>' + e(label) + '</span><b class="' + (count ? 'some' : 'none') + '">' + n(count) + '</b>' +
    (count && d.canImport ? '<a href="' + href + '">Open</a>' : '') + '</li>').join('') + '</ul>';

  // The newest changes: the last import and the route days changed most lately.
  const lines = [];
  if (d.imported && d.imported.at) lines.push({ at: d.imported.at, what: 'Route Menu brought in' + (d.imported.fileName ? ': ' + d.imported.fileName : ''), by: d.imported.by });
  if (d.master && d.master.at) lines.push({ at: d.master.at, what: 'Master list updated' + (d.master.fileName ? ': ' + d.master.fileName : ''), by: d.master.by });
  days.filter(rd => rd.updatedAt).forEach(rd => lines.push({ at: rd.updatedAt, what: routeLabel(rd.route) + ' ' + U.DAY_NAMES[rd.day] + ' changed', by: rd.updatedBy, href: 'route-sequence.html?route=' + encodeURIComponent(rd.route) + '&day=' + rd.day }));
  lines.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  $('hm-changes').innerHTML = lines.length
    ? '<ul class="hm-list hm-changes">' + lines.slice(0, 8).map(x => '<li><span class="hm-date">' + e(shortDate(x.at)) + '</span><span>' + (x.href ? '<a href="' + x.href + '">' + e(x.what) + '</a>' : e(x.what)) + '</span><small>' + e(String(x.by || '').split('@')[0]) + '</small></li>').join('') + '</ul>'
    : '<p class="hm-none">No changes yet.</p>';
  const asOf = lines.length ? shortDate(lines[0].at) : '';
  $('hm-asof').textContent = asOf ? 'The list as of ' + asOf : '';
}

requireSignIn(async () => {
  try { draw(await readList()); } catch (err) { showError(serverText(err, 'the customer list')); }
});
