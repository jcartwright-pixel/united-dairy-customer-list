/*
 * The United Dairy Customer List's server: one call, customerList. It runs in the same Firebase project as Operations (its own
 * group of functions, "udcl"), so the same United Dairy Google sign-in and Users list apply, and Operations reads the same
 * records for its bridges (the Sales app's customers and the drivers' route book).
 */
'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'us-east4', maxInstances: 5 });
const db = getFirestore();
const { unitedDairyUser } = require('./src/auth');

const CODES = { NOT_ALLOWED: 'permission-denied', BAD_REQUEST: 'invalid-argument', NOT_FOUND: 'not-found', CHANGED: 'aborted' };

exports.customerList = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const user = unitedDairyUser(request.auth);
  if (!user) throw new HttpsError('permission-denied', 'Sign in with your United Dairy Google account');
  const C = require('./src/udcl');
  const input = request.data || {};
  try {
    return await C.udclCall(db, user, String(input.plant || ''), input);
  } catch (error) {
    if (error instanceof C.UdclError) throw new HttpsError(CODES[error.code] || 'failed-precondition', error.message);
    console.error('customerList', error);
    throw new HttpsError('internal', 'internal');
  }
});


/*
 * Joe 11-9-26 ("The hub is the only thing allowed to save to the customer list") and 11-12-26 (the MapMaker): a change another
 * app sent to the Hub is saved here once an administrator approves it on the Hub's Customer Changes screen. Built so far: map
 * points (src/hubchanges.js). It runs when a change turns approved, and once an hour for any that were missed.
 */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.udclHubChange = onDocumentWritten('hubCustomerChanges/{id}', async (event) => {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.status !== 'approved') return;
  const H = require('./src/hubchanges');
  if (H.BUILT.indexOf(after.kind) < 0) return;
  const out = await H.applyAndPublish(db, event.params.id, new Date().toISOString());
  console.log('hub change', event.params.id, after.kind, out.done);
});

exports.udclHubChangeSweep = onSchedule({ schedule: 'every 60 minutes', timeoutSeconds: 300 }, async () => {
  const H = require('./src/hubchanges');
  const ids = await H.waitingIds(db);
  for (const id of ids) {
    try { await H.applyAndPublish(db, id, new Date().toISOString()); } catch (error) { console.error('hub change', id, error); }
  }
  if (ids.length) console.log('hub changes swept', ids.length);
});
