'use strict';
/*
 * Loads checked ship-to addresses into the live Customer List without anyone signing in (Joe 11/2: "push and make that live";
 * he wants Claude to do every step). Run by the Load Addresses workflow with the Firebase deploy key.
 *
 * This repository is public, so the addresses are never in it readable: data/addresses.<project>.enc.json holds them encrypted
 * to a key pair whose private half lives only in the project's database (private/udcl_address_key, which only the server and
 * this key can read). The workflow prints only counts, never an address.
 *
 *   node scripts/load-addresses.js key                      makes the key pair the first time; prints the public half
 *   node scripts/load-addresses.js load <file> <plant>      decrypts <file> and loads it (udcl.js loadAddresses)
 *
 * Encrypting (on Claude's side): a random AES-256-GCM key encrypts the JSON rows; RSA-OAEP (SHA-256) with the public half wraps
 * that key. File: { v: 1, plant, key, iv, tag, data } (base64).
 */
const crypto = require('crypto');
const fs = require('fs');
const admin = require('firebase-admin');

const KEY_DOC = ['private', 'udcl_address_key'];

function db() {
  if (!admin.apps.length) {
    const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  }
  return admin.firestore();
}

async function keyPair(create) {
  const ref = db().collection(KEY_DOC[0]).doc(KEY_DOC[1]);
  const snap = await ref.get();
  if (snap.exists) return snap.data();
  if (!create) throw new Error('No address key yet: run this workflow with step "key" first.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const k = { publicPem: publicKey, privatePem: privateKey, createdAt: new Date().toISOString() };
  await ref.create(k);
  return k;
}

function decrypt(file, privatePem) {
  const box = JSON.parse(fs.readFileSync(file, 'utf8'));
  const aes = crypto.privateDecrypt({ key: privatePem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(box.key, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', aes, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const rows = JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
  return { plant: box.plant, rows };
}

async function main() {
  const [step, file, plantArg] = process.argv.slice(2);
  if (step === 'key') {
    const k = await keyPair(true);
    console.log('Public key for the address files (safe to share):\n' + k.publicPem);
    return;
  }
  if (step === 'load') {
    if (!file || !fs.existsSync(file)) {
      // No file for this project yet: make sure the key pair is there and show its public half to encrypt one with.
      const k = await keyPair(true);
      console.log('::notice::No address file for this project yet; nothing was loaded.\nPublic key for the address files (safe to share):\n' + k.publicPem);
      return;
    }
    const k = await keyPair(false);
    const { plant, rows } = decrypt(file, k.privatePem);
    const target = plantArg || plant;
    if (!target) throw new Error('No plant named.');
    const out = await require('../src/udcl').loadAddresses(db(), target, rows, 'claude-address-loader', new Date().toISOString());
    console.log('Addresses for ' + target + ': ' + rows.length + ' in the file, ' + out.changed + ' changed, ' + out.same + ' already right, ' + out.missing + ' not on the list, ' + out.refused + ' refused (not a street address).');
    return;
  }
  throw new Error('Step must be key or load.');
}

if (require.main === module) main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
module.exports = { decrypt };
