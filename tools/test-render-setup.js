const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { buildXlsx, forms, normalizeForLibreOffice } = require('../lib/build.js');

const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

async function workbookFrom(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function checkFitForm(formId, itemCount) {
  const form = forms().find(item => item.id === formId);
  const item = { w: 1, h: 1, data: jpeg, fields: { memo: '테스트' } };
  const xlsx = await buildXlsx({ form: formId, items: Array.from({ length: itemCount }, () => item) });
  const workbook = await workbookFrom(xlsx);
  const sheet = workbook.getWorksheet(form.sheet);

  assert.equal(sheet.pageSetup.fitToPage, false, `${formId}: XLSX page setup must stay unchanged`);
  normalizeForLibreOffice(sheet, form, itemCount);
  assert.equal(sheet.pageSetup.fitToPage, false, `${formId}: PDF copy must use measured scale mode`);
  assert.equal(sheet.pageSetup.fitToWidth, undefined);
  assert.equal(sheet.pageSetup.fitToHeight, undefined);
  assert.equal(sheet.pageSetup.scale, 85);
  const blocks = Math.ceil(itemCount / form.perPage);
  assert.equal(sheet.pageSetup.printArea, `A1:R${(form.blockStart || 1) - 1 + blocks * form.block}`);
  const expectedBreaks = Array.from(
    { length: Math.max(0, blocks - 1) },
    (_, index) => (form.blockStart || 1) - 1 + (index + 1) * form.block,
  );
  assert.deepEqual(sheet.rowBreaks.map(item => item.id), expectedBreaks);

  const savedBuffer = await workbook.xlsx.writeBuffer();
  const roundTrip = await workbookFrom(savedBuffer);
  const savedSheet = roundTrip.getWorksheet(form.sheet);
  const saved = savedSheet.pageSetup;
  assert.equal(saved.fitToPage, false, `${formId}: scale mode must survive XLSX serialization`);
  assert.equal(saved.scale, 85);
  const zip = await JSZip.loadAsync(savedBuffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const savedBreaks = [...xml.matchAll(/<brk id="(\d+)"[^>]*man="1"/g)].map(match => Number(match[1]));
  assert.deepEqual(savedBreaks, expectedBreaks);
}

async function main() {
  for (const formId of ['jaejae', 'jangbi']) {
    await checkFitForm(formId, 1);
    await checkFitForm(formId, 3);
  }
  console.log('LibreOffice PDF page setup tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
