/*
 * A customer's card, the same on Customers and on Routes (Joe 11/3: "I want to be able to edit the customer. Like, it can change
 * the account number ... or the name", and "that same feature ... whenever I'm viewing the customer also").
 * Every box saves when it is left. A new account number moves the customer to its new key (changeAccount on the server), with
 * its route days. The Group box lists the plant's groups; an administrator can add a new one from the same box.
 *
 * openCard({ data, key, routesHtml, onSaved(customer, oldKey, out), onGroups(groups) }); key null adds a customer.
 * data: what readList gave ({ customers, groups, plant, canEdit, canImport }).
 */
import { escapeHtml as e, serverText } from './shell.js';
import { saveStep, U } from './udcl.js';

const $ = (id) => document.getElementById(id);
const NEW_GROUP = '+';

export function closeCard() { const p = $('panel'); if (p) p.remove(); window.udBack = null; }

/** The side panel the card (and Routes' Upload box) sits in. */
export function panel(title, body) {
  closeCard();
  const p = document.createElement('aside');
  p.className = 'udcl-panel'; p.id = 'panel';
  p.innerHTML = '<header><h2>' + e(title) + '</h2><button type="button" id="p-close">Close</button></header><div class="body">' + body + '</div>';
  document.body.appendChild(p);
  $('p-close').onclick = closeCard;
  window.udBack = () => { if ($('panel')) { closeCard(); return true; } return false; };
  return p;
}

/** The Group drop-down: no group, the plant's groups, and (for an administrator) "+ New group…". */
export function groupOptions(groups, now, canAdd) {
  const list = (groups || []).slice();
  if (now && !list.includes(now)) list.push(now);
  return '<option value="">No group</option>' + list.map(g => '<option' + (g === now ? ' selected' : '') + '>' + e(g) + '</option>').join('') +
    (canAdd ? '<option value="' + NEW_GROUP + '">+ New group…</option>' : '');
}

/**
 * Asks for a new group's name in place of the drop-down sel, adds it to the plant's groups (saveGroups) and gives back its name,
 * or '' when nothing was added. onGroups(groups) gets the plant's new list of group names.
 */
export function askNewGroup(sel, onGroups) {
  return new Promise(done => {
    const box = document.createElement('input');
    box.className = sel.className + ' grp-new'; box.placeholder = 'New group name, then Enter'; box.maxLength = U.LIMITS.group;
    box.setAttribute('aria-label', 'New group name');
    sel.hidden = true; sel.after(box); box.focus();
    let over = false;
    const end = (name) => { if (over) return; over = true; box.remove(); sel.hidden = false; done(name); };
    const add = async () => {
      const name = box.value.trim();
      if (!name) return end('');
      box.disabled = true;
      try {
        const out = await saveStep('saveGroups', { add: name });
        onGroups(out.groups.map(g => g.name));
        end(name);
      } catch (err) {
        box.disabled = false; box.focus();
        box.title = serverText(err, 'the customer list'); box.classList.add('bad'); box.value = ''; box.placeholder = box.title;
      }
    };
    box.addEventListener('keydown', k => { if (k.key === 'Enter') { k.preventDefault(); add(); } if (k.key === 'Escape') { k.stopPropagation(); end(''); } });
    box.addEventListener('blur', () => { if (!box.disabled) (box.value.trim() ? add() : end('')); });
  });
}

const dcChoices = (now) => (now && !U.DCS.some(d => d.code === now) ? [{ code: now, name: 'DC ' + now }] : []).concat(U.DCS)
  .map(d => '<option value="' + d.code + '"' + (now === d.code ? ' selected' : '') + '>' + d.code + ' ' + e(d.name) + '</option>').join('');

export function openCard(o) {
  const data = o.data, c = o.key ? data.customers[o.key] : null, add = !c, ro = !data.canEdit;
  let key = c ? c.key : null;
  const v = (k) => e(c && c[k] !== undefined && c[k] !== null ? c[k] : '');
  const dis = ro ? ' disabled' : '';
  const gps = c && c.lat && c.lon ? Number(c.lat).toFixed(5) + ', ' + Number(c.lon).toFixed(5) : '';
  const check = c && (c.addressCheck || c.addressProposed || gps) ? '<div class="deliveries">' + [c.addressCheck && 'Address check: ' + e(c.addressCheck), c.addressProposed && 'Proposed address: <b>' + e(c.addressProposed) + '</b>',
    c.addressNote && e(c.addressNote), gps && 'GPS <a href="https://www.google.com/maps?q=' + encodeURIComponent(c.lat + ',' + c.lon) + '" target="_blank" rel="noopener">' + e(gps) + '</a>' + (c.gpsFrom ? ' (' + e(c.gpsFrom) + ')' : '')].filter(Boolean).join('<br>') + '</div>' : '';
  const p = panel(add ? 'Add a customer' : c.name,
    (c && (o.routesHtml || c.inactive) ? '<div class="deliveries">' + (c.inactive ? '<b>Inactive</b>: it shows only on Customers.<br>' : '') + (o.routesHtml || '') + '</div>' : '') +
    '<div class="two"><label>Account number<input id="c-account" inputmode="numeric" value="' + v('account') + '"' + (add ? ' placeholder="Leave blank if it has none"' : '') + dis + '></label>' +
    '<label>Chain<input id="c-chain" value="' + v('chain') + '"' + dis + '></label></div>' +
    '<label>Name<input id="c-name" value="' + v('name') + '"' + dis + '></label>' +
    '<div class="two"><label>Group<select id="c-group"' + dis + '>' + groupOptions(data.groups, c ? c.group || '' : '', !!data.canImport && !ro) + '</select></label>' +
    '<label>Phone<input id="c-phone" value="' + v('phone') + '"' + dis + '></label></div>' +
    '<label>Distribution center<select id="c-dc"' + dis + '><option value="">Not set</option>' + dcChoices(c ? U.branchOf(c.dc) : (U.PLANT_DC[data.plant] || '')) + '</select></label>' +
    check +
    '<label>Street<input id="c-address" value="' + v('address') + '"' + dis + '></label><label>Street, line 2<input id="c-address2" value="' + v('address2') + '"' + dis + '></label>' +
    '<div class="three"><label>City<input id="c-city" value="' + v('city') + '"' + dis + '></label><label>State<input id="c-state" value="' + v('state') + '" maxlength="4"' + dis + '></label><label>Zip<input id="c-zip" value="' + v('zip') + '"' + dis + '></label></div>' +
    '<label>Contact<input id="c-contact" value="' + v('contact') + '"' + dis + '></label>' +
    '<label>Keys or door code<input id="c-keys" value="' + v('keys') + '"' + dis + '></label>' +
    '<label>Notes for the driver (shows on the route book at every stop for this customer)<textarea id="c-notes"' + dis + '>' + v('notes') + '</textarea></label>' +
    (add ? '<button type="button" class="primary" id="c-save">Add customer</button>' : '') + '<div id="c-msg" role="status"></div>');
  const say = (t, cls) => { $('c-msg').innerHTML = t ? '<div class="msg ' + (cls || '') + '">' + e(t) + '</div>' : ''; };
  if (ro) return p;
  const groups = (list) => { data.groups = list; if (o.onGroups) o.onGroups(list); };
  const grp = $('c-group');
  let lastGroup = grp.value;
  const fields = () => { const f = {}; U.CUSTOMER_FIELDS.forEach(k => { const el = $('c-' + k); if (el) f[k] = el.value; }); return f; };

  grp.addEventListener('change', async (ev) => {
    if (grp.value !== NEW_GROUP) return;
    ev.stopImmediatePropagation();
    const name = await askNewGroup(grp, groups);
    grp.innerHTML = groupOptions(data.groups, name || lastGroup, true);
    if (name && !add) grp.dispatchEvent(new Event('change'));
  }, true);

  if (add) {
    $('c-save').onclick = async () => {
      try {
        const out = await saveStep('saveCustomer', { add: true, account: $('c-account').value, fields: fields() });
        data.customers[out.customer.key] = out.customer;
        if (o.onSaved) o.onSaved(out.customer, null, out);
        openCard(Object.assign({}, o, { key: out.customer.key }));
      } catch (err) { say(serverText(err, 'the customer list'), 'bad'); }
    };
    return p;
  }
  p.querySelectorAll('input, textarea, select').forEach(el => el.addEventListener('change', async () => {
    const what = el.id.slice(2);
    try {
      say('Saving…');
      const out = what === 'account'
        ? await saveStep('changeAccount', { key, account: el.value })
        : await saveStep('saveCustomer', { key, fields: { [what]: el.value } });
      const was = key;
      if (out.oldKey && out.oldKey !== out.customer.key) delete data.customers[out.oldKey];
      data.customers[out.customer.key] = out.customer; key = out.customer.key;
      if (what === 'group') lastGroup = el.value;
      if (what === 'name') p.querySelector('header h2').textContent = out.customer.name;
      if (o.onSaved) o.onSaved(out.customer, was, out);
      say(out.message || 'Saved.', 'good');
    } catch (err) {
      if (what === 'account') el.value = (data.customers[key] || {}).account || '';
      say(serverText(err, 'the customer list'), 'bad');
    }
  }));
  return p;
}
