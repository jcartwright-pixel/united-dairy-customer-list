// Administration (Joe 11/1, administrators only): the Load Map Kiosk link, the last Route Menu upload, and (Joe 11/3) the groups:
// "in administration is where I'd like to add groups." A customer's group is set on Customers; here groups are added, renamed
// and removed. Renaming or removing one changes every customer that has it (saveGroups on the server).
import { requireSignIn, escapeHtml as e, showError, serverText, shortDate } from './shell.js';
import { readList, saveStep } from './udcl.js';

const $ = (id) => document.getElementById(id);
let groups = [];        // [{ name, customers }]
let editing = '';       // the group whose name is being changed

function say(text, cls) { $('g-msg').className = 'adm-msg' + (cls ? ' ' + cls : ''); $('g-msg').textContent = text || ''; }

function draw() {
  $('g-rows').innerHTML = groups.map(g => editing === g.name
    ? '<tr data-name="' + e(g.name) + '"><td class="l"><input class="g-name" maxlength="40" value="' + e(g.name) + '" aria-label="New name for ' + e(g.name) + '"></td><td>' + g.customers.toLocaleString() + '</td>' +
      '<td class="r"><button type="button" class="primary" data-act="save">Save</button> <button type="button" data-act="cancel">Cancel</button></td></tr>'
    : '<tr data-name="' + e(g.name) + '"><td class="l"><b>' + e(g.name) + '</b></td><td>' + g.customers.toLocaleString() + '</td>' +
      '<td class="r"><button type="button" data-act="rename">Rename</button> <button type="button" data-act="remove">Remove</button></td></tr>').join('') ||
    '<tr><td colspan="3" class="empty">No groups yet. Type a name above and press Add group.</td></tr>';
  const box = $('g-rows').querySelector('input.g-name');
  if (box) { box.focus(); box.select(); }
}

async function change(fields) {
  say('Saving…');
  try {
    const out = await saveStep('saveGroups', fields);
    groups = out.groups; editing = ''; draw(); say(out.message, 'good'); return true;
  } catch (err) { say(serverText(err, 'the customer list'), 'bad'); return false; }
}

$('g-add-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('g-new').value.trim();
  if (!name) return say('Type the new group\'s name first.', 'bad');
  if (await change({ add: name })) $('g-new').value = '';
});
$('g-rows').addEventListener('click', async ev => {
  const b = ev.target.closest('button[data-act]'); if (!b) return;
  const name = b.closest('tr').dataset.name, g = groups.find(x => x.name === name), act = b.dataset.act;
  if (act === 'rename') { editing = name; draw(); say(''); }
  else if (act === 'cancel') { editing = ''; draw(); }
  else if (act === 'save') {
    const to = b.closest('tr').querySelector('input.g-name').value.trim();
    if (!to || to === name) { editing = ''; return draw(); }
    await change({ rename: { from: name, to } });
  } else if (act === 'remove') {
    if (g && g.customers && !window.confirm(g.customers + ' customer' + (g.customers === 1 ? ' is' : 's are') + ' in ' + name + '. Removing the group takes it off ' + (g.customers === 1 ? 'that customer' : 'them') + '. Go ahead?')) return;
    await change({ remove: name });
  }
});
$('g-rows').addEventListener('keydown', ev => {
  if (!ev.target.matches('input.g-name')) return;
  if (ev.key === 'Enter') { ev.preventDefault(); ev.target.closest('tr').querySelector('[data-act="save"]').click(); }
  if (ev.key === 'Escape') { editing = ''; draw(); }
});

requireSignIn(async () => {
  try {
    const d = await readList({ all: true });
    $('plant-name').textContent = d.plantName || '';
    $('not-admin').hidden = !!d.canImport;
    const counts = {};
    Object.values(d.customers).forEach(c => { if (c.group) counts[c.group] = (counts[c.group] || 0) + 1; });
    groups = (d.groups || []).map(name => ({ name, customers: counts[name] || 0 }));
    draw();
    const m = d.imported;
    $('imported').textContent = m && m.at ? 'Last Route Menu upload ' + shortDate(m.at) + ' by ' + (m.by || '') + (m.fileName ? ' from ' + m.fileName : '') + '.' : 'No Route Menu has been uploaded for this plant yet.';
  } catch (err) { showError(serverText(err, 'the customer list')); }
});
