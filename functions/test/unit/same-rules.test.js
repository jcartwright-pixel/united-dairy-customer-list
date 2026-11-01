'use strict';
// The rules the screens and the server share (udcl-rules.js) are one file kept in two places; both copies must match.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
test('the screens and the server use the same rules file', () => {
  const a = fs.readFileSync(path.join(__dirname, '../../src/udcl-rules.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '../../../public/js/udcl-rules.js'), 'utf8');
  assert.equal(a, b, 'copy functions/src/udcl-rules.js to public/js/udcl-rules.js (npm run sync)');
});
test('every screen has a help part', () => {
  const md = fs.readFileSync(path.join(__dirname, '../../../public/help.md'), 'utf8');
  for (const page of fs.readdirSync(path.join(__dirname, '../../../public')).filter(f => f.endsWith('.html') && f !== 'help.html')) {
    assert.ok(new RegExp('^screens: .*' + page.replace('.', '\\.'), 'm').test(md), page + ' needs a part in help.md');
  }
});
