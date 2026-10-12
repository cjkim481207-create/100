#!/usr/bin/env node
// Regression checks for the actual /api/render load -> normalize -> save path.
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { createCanvas } = require('@napi-rs/canvas');
const { buildXlsx, forms } = require('../lib/build');

process.env.RENDER_SERVICE_URL = 'https://renderer.test';
const render = require('../api/render');
const canvas = createCanvas(160, 120);
const g = canvas.getContext('2d');
g.fillStyle = '#2874a6'; g.fillRect(0, 0, 160, 120);
const photo = canvas.toBuffer('image/jpeg').toString('base64');
const item = { data: photo, w: 160, h: 120, fields: { loc: '201동', memo: '기초터파기 완료 후' } };

async function inspect(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return {
    book: await zip.file('xl/workbook.xml').async('string'),
    sheet: await zip.file('xl/worksheets/sheet1.xml').async('string'),
  };
}

async function main() {
  const originalFetch = global.fetch;
  try {
    for (const count of [1, 2, 3, 4, 7, 12]) {
      let converted;
      global.fetch = async (url, options) => {
        converted = Buffer.from(JSON.parse(options.body).xlsx, 'base64');
        return { ok: true, json: async () => ({ pdf: '' }) };
      };
      const body = { form: 'daeji2', date: '2026-10-10', site: '검사 현장', items: Array(count).fill(item) };
      await render({ method: 'POST', body }, {
        setHeader() {}, status(code) { assert.equal(code, 200); return this; }, send() {},
        json(value) { throw new Error(JSON.stringify(value)); },
      });
      assert.ok(converted, 'renderer received a workbook');
      const pages = Math.ceil(count / 2), rows = pages * 30;
      for (const buffer of [await buildXlsx(body), converted]) {
        const { book, sheet } = await inspect(buffer);
        assert.ok(book.includes(`!$A$1:$I$${rows}</definedName>`), 'absolute print area survives saving');
        assert.match(sheet, /<pageSetUpPr fitToPage="1"/);
        assert.ok(sheet.includes(`fitToHeight="${pages}"`), 'A4 height fits all complete blocks');
        const breaks = [...sheet.matchAll(/<brk id="(\d+)"[^>]*max="(\d+)"/g)];
        assert.deepEqual(breaks.map(m => Number(m[1])), Array.from({ length: pages - 1 }, (_, i) => (i + 1) * 30));
        assert.ok(breaks.every(m => Number(m[2]) === 16383));
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0];
        assert.equal(ws.getImages().length, count);
        for (let page = 0; page < pages; page++) {
          assert.equal(ws.getCell(page * 30 + 1, 1).value, '사  진  대  지');
          for (const row of [4, 5, 13, 18, 19, 27]) {
            assert.equal(ws.getCell(page * 30 + row, 1).border.bottom, undefined, 'no padding ticks inside photo box');
          }
        }
      }
      console.log(`✓ ${count} photos: ${pages} A4 pages, correct range, breaks and borders`);
    }
    const form = forms()[0];
    const canonical = await buildXlsx({ form: form.id, items: [item] });
    const stale = await buildXlsx({ form: form.id, formDef: { ...form, block: 999 }, template: 'stale-data', items: [item] });
    assert.deepEqual((await inspect(stale)).book, (await inspect(canonical)).book, 'stale built-in form data cannot override server template');
    console.log('✓ stale built-in form data ignored');
  } finally { global.fetch = originalFetch; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
