/*
 * Who may use the Customer List: the company's Users list (users/<email>), the same list Operations keeps. These rules match
 * Operations' (an ACTIVE person; Administrator, Admin or Manager roles; the plants a person is set up for) so one person has the
 * same rights in both apps. The plants are the company's plants; each plant's customers carry its distribution center code.
 */
'use strict';

const PLANTS = [
  { id: 'fac_uniontown', name: 'Uniontown', status: 'ACTIVE' },
  { id: 'fac_charleston', name: 'Charleston', status: 'PLANNED' },
  { id: 'fac_martins_ferry', name: 'Martins Ferry', status: 'PLANNED' }
];
const HOME_PLANT = 'fac_uniontown';
const ADMIN_ROLES = ['ADMINISTRATOR', 'ADMIN'];

const roleKey = (r) => String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
function hasRole(person, roles) {
  const want = (roles || []).map(roleKey);
  return !!(person && String(person.status || '').trim().toUpperCase() === 'ACTIVE' && (person.roles || []).some(r => want.indexOf(roleKey(r)) >= 0));
}
const isAdmin = (person) => hasRole(person, ADMIN_ROLES);
function plantsFor(person) {
  if (!person || person.status !== 'ACTIVE') return [];
  const list = (person.facilities || []).map(String);
  if (list.indexOf('*') >= 0 || (!list.length && isAdmin(person))) return PLANTS.map(p => p.id);
  const known = PLANTS.map(p => p.id).filter(id => list.indexOf(id) >= 0);
  return known.length ? known : [HOME_PLANT];
}
const safeIdPart = (value) => String(value || '').trim().replace(/[\/\s]+/g, '_').replace(/[^A-Za-z0-9_.@\-|]/g, '').slice(0, 200);

module.exports = { PLANTS, HOME_PLANT, hasRole, isAdmin, plantsFor, safeIdPart };
