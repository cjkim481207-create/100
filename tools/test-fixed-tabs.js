const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const match = app.match(/const BUILTIN_FORM_IDS = new Set\((\[[^;]+\])\);/);
assert(match, 'built-in form ID set is missing');
const ids = vm.runInNewContext(match[1]);
assert.deepEqual(Array.from(ids), ['daeji2', 'jaejae', 'jangbi', 'yongyeok']);
assert.match(app, /fixedForms = FORMS\.filter\(f => BUILTIN_FORM_IDS\.has\(f\.id\)\)/);
assert.match(app, /BUILTIN_FORM_IDS\.has\(f\.id\) \|\| !hidden\.has\(f\.id\)/);
assert.doesNotMatch(app, /h\.add\(id\)/, 'built-in forms must never be hidden on one device');
assert.match(html, /#tabs \.tab-row\.fixed\{flex-wrap:wrap\}/);
console.log('fixed built-in tab tests passed');
