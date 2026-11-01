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

