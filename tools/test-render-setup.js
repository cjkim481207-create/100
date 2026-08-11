const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
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
  assert.equal(sheet.pageSetup.fitToPage, true, `${formId}: PDF copy must enable fit-to-page`);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, Math.ceil(itemCount / form.perPage));
  assert.equal(sheet.pageSetup.scale, undefined);

  const roundTrip = await workbookFrom(await workbook.xlsx.writeBuffer());
  const saved = roundTrip.getWorksheet(form.sheet).pageSetup;
  assert.equal(saved.fitToPage, true, `${formId}: fit-to-page must survive XLSX serialization`);
  assert.equal(saved.fitToHeight, Math.ceil(itemCount / form.perPage));
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
