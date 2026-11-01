/*
 * The Customer List's own frame (Joe 11/1: "I would really like it separated ... Still want the bridge, but keep it separate").
 * Sign-in, the header, the menu and the one server call. It uses the same Firebase project as Operations, so the same United
 * Dairy Google sign-in and the same Users list decide who gets in; nothing here is shared code with Operations.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';

const DOMAIN = 'uniteddairy.com';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const HERE = location.pathname.split('/').pop() || 'index.html';
const QS = new URLSearchParams(location.search);

// The screens, in the menu's order. Joe 11/1: the Load Map Kiosk is not in the menu; it is a view-only link on Administration
// (administrators only), and the kiosk itself has just an Administration button.
export const SCREENS = [
  { href: 'index.html', name: 'Home', note: 'The Customer List screens' },
  { href: 'customers.html', name: 'Customers', note: 'Every customer by customer, route or day; sort, filter, print' },
  { href: 'route-sequence.html', name: 'Route Sequence', note: 'Change a route day\'s run order and print it for the office' },
  { href: 'load-map.html', name: 'Truck Load Map', note: 'How the truck is loaded, the customers beside it' },
  { href: 'administration.html', name: 'Administration', note: 'Administrators only: the Load Map Kiosk view and the last import', admin: true },
  { href: 'help.html', name: 'Help', note: 'How each screen works' }
];

let services = null;
async function start() {
  if (services) return services;
  const config = LOCAL ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-ud-distribution', appId: 'demo-app' } : await (await fetch('/__/firebase/init.json')).json();
  const app = initializeApp(config);
  const auth = getAuth(app), functions = getFunctions(app, 'us-east4');
  if (LOCAL) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
  services = { app, auth, functions };
  return services;
}

// The plant the list is for: the one picked on Customers (kept for this browser), else the server picks the person's first.
export function currentPlant() {
  const q = QS.get('plant');
  if (q) { try { localStorage.setItem('udcl.plant', q); } catch (e) { /* no storage */ } return q; }
  try { return localStorage.getItem('udcl.plant') || ''; } catch (e) { return ''; }
}
export function setPlant(p) { try { localStorage.setItem('udcl.plant', p); } catch (e) { /* no storage */ } }

export async function callServer(name, fields) {
  const { functions } = await start();
  const res = await httpsCallable(functions, name, { timeout: 120000 })(Object.assign({ plant: currentPlant() }, fields || {}));
  return res.data;
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function serverText(err, what) {
  const code = String(err && err.code || '').replace(/^functions\//, ''), msg = String(err && err.message || err || '');
  if (code === 'internal' || code === 'unknown' || /^(internal|unknown)\b/i.test(msg) || !msg) return 'Could not reach ' + what + '. Check the network and try again.';
  return msg;
}

export function showError(text) {
  if (text && typeof text === 'object') text = serverText(text, 'the server');
  ['error', 'signin-error'].forEach(id => { const box = document.getElementById(id); if (box) { box.textContent = text || ''; box.hidden = !text; } });
}

// One short date everywhere, like 11-1-26 (Eastern time).
export function shortDate(v) {
  if (v == null || v === '') return '';
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(v));
  if (m) return Number(m[2]) + '-' + Number(m[3]) + '-' + m[1].slice(2);
  const t = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  if (isNaN(t)) return String(v);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: '2-digit', month: 'numeric', day: 'numeric' }).formatToParts(t);
  const g = (k) => (p.find(x => x.type === k) || {}).value;
  return g('month') + '-' + g('day') + '-' + g('year');
}

// Prints a page of HTML from a hidden frame, so the screen stays where it is.
export function printInFrame(html, opts) {
  const o = opts || {};
  const old = o.id && document.getElementById(o.id);
  if (old) old.remove();
  const f = document.createElement('iframe');
  if (o.id) f.id = o.id;
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open(); d.write(html); d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, o.wait || 150);
  return f;
}

/* ---------- the installed app (Joe 11/1: "want to downloadable app") ---------- */
if ('serviceWorker' in navigator && !LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installPrompt = ev; document.dispatchEvent(new Event('udcl-installable')); });
/** Whether this window is already the installed app. */
export const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** Opens the browser's own Install box; false when the browser has none to give (iPhone and iPad: Share, Add to Home Screen). */
export async function installApp() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  return true;
}
export const canInstall = () => !!installPrompt;

/* ---------- the header and the menu ---------- */
const hereHref = () => HERE + (QS.get('kiosk') === '1' ? '?kiosk=1' : '');
function drawFrame() {
  const bar = document.querySelector('#screen > .topbar');
  if (bar && !bar.querySelector('.brand')) {
    const brand = document.createElement('a');
    brand.className = 'brand'; brand.href = 'index.html';
    brand.innerHTML = '<img src="img/ud-logo.webp" alt="United Dairy"><span><strong>Customer List</strong><small><span class="plant-name" id="bar-plant"></span></small></span>';
    bar.prepend(brand);
    const help = document.createElement('a');
    help.href = 'help.html#' + (document.body.dataset.help || 'home'); help.textContent = '? Help'; help.className = 'help-link';
    bar.insertBefore(help, document.getElementById('who'));
    if (document.body.classList.contains('udcl-kiosk')) {
      const admin = document.createElement('a');
      admin.href = 'administration.html'; admin.className = 'button admin-only'; admin.id = 'go-admin'; admin.textContent = 'Administration';
      brand.after(admin);
    }
  }
  const screen = document.getElementById('screen');
  if (screen && !document.getElementById('udcl-nav') && document.body.dataset.nav !== 'none' && !document.body.classList.contains('udcl-kiosk')) {
    const nav = document.createElement('nav');
    nav.id = 'udcl-nav'; nav.className = 'udcl-nav'; nav.setAttribute('aria-label', 'Customer List screens');
    nav.innerHTML = SCREENS.filter(s => s.href !== 'help.html').map(s => '<a href="' + s.href + '"' + (s.admin ? ' class="admin-only"' : '') + (s.href === hereHref() ? ' aria-current="page"' : '') + '>' + escapeHtml(s.name) + '</a>').join('');
    bar.insertAdjacentElement('afterend', nav);
  }
}
export function showPlant(name) { const el = document.getElementById('bar-plant'); if (el) el.textContent = name ? String(name).toUpperCase() : ''; }

/** Shows the screen once someone with a United Dairy account is signed in; ready(user) then reads the list. */
export async function requireSignIn(ready) {
  drawFrame();
  const gate = document.getElementById('signin'), screen = document.getElementById('screen');
  const { auth } = await start();
  onAuthStateChanged(auth, async (user) => {
    if (!user) { gate.hidden = false; screen.hidden = true; return; }
    const email = String(user.email || '').toLowerCase();
    if (!user.emailVerified || !email.endsWith('@' + DOMAIN)) {
      await signOut(auth);
      showError('Only United Dairy Google accounts can use the Customer List. You were signed out.');
      return;
    }
    gate.hidden = true; screen.hidden = false;
    const who = document.getElementById('who');
    if (who) {
      const parts = String(user.displayName || '').trim().split(/\s+/).filter(Boolean);
      who.textContent = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || email).slice(0, 2)).toUpperCase();
      who.title = email; who.classList.add('initials');
    }
    ready(user);
  });
  const btn = document.getElementById('signin-button');
  if (btn) btn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: DOMAIN, prompt: 'select_account' });
    try { await signInWithPopup(auth, provider); } catch (e) { showError('Sign-in did not finish: ' + (e.message || e)); }
  });
  const out = document.getElementById('signout');
  if (out) out.addEventListener('click', () => signOut(auth));
  // Local testing only: the emulator takes a made-up Google sign-in (?testEmail=someone@uniteddairy.com).
  const testEmail = LOCAL && QS.get('testEmail');
  if (testEmail) {
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.email !== testEmail) {
      const token = JSON.stringify({ sub: 'test-' + testEmail, email: testEmail, email_verified: true });
      await signInWithCredential(auth, GoogleAuthProvider.credential(token)).catch(e => showError(String(e.message || e)));
    }
  }
}
