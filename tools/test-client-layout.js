#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');
const forms = require('../templates/forms.json');
const memory = new Map([['hiddenForms', JSON.stringify(forms.map(f => f.id))]]);
const nodes = new Map(), listeners = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, {
    value: '', innerHTML: '', textContent: '', style: {}, disabled: false,
    classList: { contains: () => false, add() {}, remove() {} },
    addEventListener(name, fn) { this[name] = fn; }, querySelectorAll: () => [],
    querySelector: () => null, focus() {}, appendChild() {},
  });
  return nodes.get(id);
};
const textCalls = [], photoCalls = [];
function canvas() {
  const cv = createCanvas(1, 1), g = cv.getContext('2d');
  cv.style = {};
  const fill = g.fillText.bind(g), draw = g.drawImage.bind(g);
  g.fillText = (text, ...args) => { textCalls.push(String(text)); fill(String(text), ...args); };
  g.drawImage = (...args) => { photoCalls.push(args); draw(...args); };
  return cv;
}
const context = vm.createContext({
  console, setTimeout, clearTimeout, Date, Map, Set, Uint8Array, TextEncoder,
  document: { getElementById: node, createElement: kind => kind === 'canvas' ? canvas() : node('element'), querySelector: () => null },
  window: { addEventListener: (name, fn) => listeners.set(name, fn) },
  localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
  navigator: { userAgent: '' }, location: { href: 'https://example.test/', reload() {} },
  fetch: async () => ({ ok: true, json: async () => structuredClone(forms) }),
  fixtureForms: forms, fixtureCanvas: createCanvas(100, 150), fixtureText: textCalls, fixturePhotos: photoCalls,
});
vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), context);
async function main() {
  vm.runInContext(`idb.all = async () => [{id: 'daeji2', def: {...fixtureForms[0], block: 999}, data: 'stale'}]; renderTabs = () => {}; renderList = () => {}; renderPreview = () => {};`, context);
  await listeners.get('DOMContentLoaded')();
  assert.equal(vm.runInContext('FORMS.length', context), 4, 'built-in tabs remain visible without duplicate cached forms');
  assert.equal(vm.runInContext('FORM.block', context), 30, 'canonical form wins over cached override');
  assert.ok(!node('defaults').innerHTML.includes('d_date'), 'date has one default input');
  vm.runInContext(`items.push({bmp:fixtureCanvas,w:100,h:150,v:{memo:'사진 내용',date:$('f_date').value}},{bmp:fixtureCanvas,w:100,h:150,v:{memo:'다른 날짜',date:'2026-09-05'}});`, context);
  node('f_date').value = '2026-10-10'; node('f_date').input();
  assert.equal(vm.runInContext('items[0].v.date', context), '2026-10-10');
  assert.equal(vm.runInContext('items[1].v.date', context), '2026-09-05', 'individual date override survives');
  memory.set('d:jangbi:업체명', '한보건설');
  vm.runInContext(`selectForm('jangbi')`, context);
  assert.equal(vm.runInContext('items[0].v.업체명', context), '한보건설', 'new tab fields receive that tab defaults');
  assert.equal(vm.runInContext('items[0].v.memo', context), '사진 내용', 'tab switch preserves existing input');
  node('f_site').value = '검사 현장';
  for (const form of forms) {
    context.selectedForm = form;
    vm.runInContext(`useForm(selectedForm); items.splice(0,items.length,...Array.from({length:7},()=>({bmp:fixtureCanvas,w:100,h:150,v:{memo:'검사',date:'2026-10-10'}})));`, context);
    const pages = vm.runInContext('pageCount()', context);
    for (let p = 0; p < pages; p++) {
      textCalls.length = 0; photoCalls.length = 0; context.pageIndex = p;
      vm.runInContext(`drawPage(document.createElement('canvas'),pageIndex,96)`, context);
      assert.ok(textCalls.some(t => t.includes('검사 현장')), `${form.id} page ${p + 1} has site name`);
      assert.equal(photoCalls.length, Math.min(form.id === 'yongyeok' ? 4 : 2, 7 - p * (form.id === 'yongyeok' ? 4 : 2)));
    }
    if (form.id === 'yongyeok') {
      vm.runInContext('items.splice(1);', context);
      photoCalls.length = 0;
      vm.runInContext(`drawPage(document.createElement('canvas'),0,96)`, context);
      assert.equal(photoCalls.length, 1, 'partial page draws only occupied blocks');
    }
  }
  console.log('✓ client: four tabs, stale cache, dates, tab values, page headers and partial pages');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
