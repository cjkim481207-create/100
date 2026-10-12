#!/usr/bin/env node
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { createCanvas } = require('@napi-rs/canvas');
const { buildXlsx, forms } = require('../lib/build');
const { buildPdf, pageCount } = require('../lib/draw');
process.env.RENDER_SERVICE_URL = 'https://renderer.test';
const render = require('../api/render');
const cv = createCanvas(120, 160), g = cv.getContext('2d');
g.fillStyle = '#4278a4'; g.fillRect(0, 0, 120, 160);
const data = cv.toBuffer('image/jpeg').toString('base64');
const colName = n => n <= 26 ? String.fromCharCode(64 + n) : 'A' + String.fromCharCode(64 + n - 26);

async function main() {
  const fetchOriginal = global.fetch;
  try {
    for (const form of forms()) {
      for (const count of [1, 2, 3, 4, 5, 7, 12]) {
        let converted;
        global.fetch = async (_, options) => {
          converted = Buffer.from(JSON.parse(options.body).xlsx, 'base64');
          return { ok: true, json: async () => ({ pdf: '' }) };
        };
        const items = Array.from({ length: count }, (_, i) => ({
          data, w: 120, h: 160, fields: { memo: `검사사진 ${i + 1}`, loc: '201동', 업체명: '한보건설' },
        }));
        const body = { form: form.id, site: '검사 현장', date: '2026-10-10', items };
        await render({ method: 'POST', body }, {
          setHeader() {}, status(code) { assert.equal(code, 200); return this; }, send() {},
          json(value) { throw new Error(JSON.stringify(value)); },
        });
        const blocks = Math.ceil(count / form.perPage), bs = form.blockStart || 1;
        const rows = bs - 1 + blocks * form.block;
        const expectedBreaks = [];
        for (let b = form.firstPageBlocks || 1; b < blocks; b += form.blocksPerPage || 1) expectedBreaks.push(bs - 1 + b * form.block);
        for (const buffer of [await buildXlsx(body), converted]) {
          const zip = await JSZip.loadAsync(buffer);
          const book = await zip.file('xl/workbook.xml').async('string');
          const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
          assert.ok(book.includes(`!$A$1:$${colName(form.cols.length)}$${rows}</definedName>`));
          assert.deepEqual([...sheet.matchAll(/<brk id="(\d+)"/g)].map(m => +m[1]), expectedBreaks);
          if (form.repeatHeader) assert.ok(book.includes(`!$1:$${bs - 1}</definedName>`), 'headers repeat on printed pages');
          const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
          const ws = wb.getWorksheet(form.sheet);
          assert.equal(ws.getImages().length, count);
          for (let i = 0; i < blocks * form.perPage; i++) {
            const slot = form.slots[i % form.perPage], offset = Math.floor(i / form.perPage) * form.block;
            const line = slot.rows.find(r => r.cells.some(c => c.field === 'memo'));
            const cell = line.cells.find(c => c.field === 'memo');
            assert.equal(ws.getCell(offset + line.row, cell.cols[0]).value, i < count ? `검사사진 ${i + 1}` : null);
          }
          if (form.id !== 'daeji2') assert.ok(ws.pageSetup.scale <= 99 && !ws.pageSetup.fitToPage);
        }
        if (count === 7) {
          const pdf = await buildPdf(body);
          assert.ok(pdf.includes(Buffer.from(`/Count ${pageCount(form, count)}`)), 'fallback PDF agrees with expected page count');
          const stale = await buildPdf({ ...body, formDef: { ...form, perPage: 100 } });
          assert.ok(stale.includes(Buffer.from(`/Count ${pageCount(form, count)}`)), 'fallback also ignores stale built-in overrides');
        }
      }
      console.log(`✓ ${form.name}: 1/2/3/4/5/7/12 photos, captions, page breaks, headers, render and fallback`);
    }
  } finally { global.fetch = fetchOriginal; }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
