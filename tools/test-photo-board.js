const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const ExcelJS = require('exceljs');
const { PhotoBoard, boardImage } = require('../lib/photo-board');
const { buildXlsx, forms } = require('../lib/build');

async function main() {
  for (const [w, h] of [[1600, 900], [900, 1600], [1200, 1200], [1600, 300]]) {
    const cv = createCanvas(w, h), g = cv.getContext('2d');
    const texts = [], fillText = g.fillText.bind(g);
    g.fillText = (text, ...args) => { texts.push(text); fillText(text, ...args); };
    const fields = { loc: '101동 지하1층', memo: '벽체 철근 배근 검측', date: '2026-11-17' };
    const bounds = PhotoBoard.draw(g, 0, 0, w, h, fields, '2000-01-01', '"Noto Sans KR"');
    const pixels = g.getImageData(Math.round(bounds.x), Math.round(bounds.y), Math.floor(bounds.width), Math.floor(bounds.height)).data;
    let white = 0, black = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 245 && pixels[i+1] > 245 && pixels[i+2] > 245) white++;
      if (pixels[i] < 80 && pixels[i+1] < 80 && pixels[i+2] < 80) black++;
    }
    assert.ok(white > pixels.length / 8 && black > 10, 'white board with black lines and text');
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= w && bounds.y + bounds.height <= h);
    assert.ok(bounds.x < w * 0.02 && bounds.y + bounds.height > h * 0.98, 'anchored at photo bottom left');
    for (const expected of ['현장명', '위치', '내용', '일자', fields.loc, fields.memo, '2026.11.17']) assert.ok(texts.includes(expected));
    assert.ok(texts.join('').includes(PhotoBoard.SITE_NAME));
    const long = PhotoBoard.draw(g, 0, 0, w, h, { memo: '긴 내용과 줄바꿈\n'.repeat(30) });
    assert.ok(long.y >= 0 && long.height <= h * 0.44, 'long text stays inside the photo');
  }
  const cv = createCanvas(1000, 750), g = cv.getContext('2d');
  g.fillStyle = '#aabbcc'; g.fillRect(0, 0, 1000, 750);
  const item = { data: cv.toBuffer('image/jpeg').toString('base64'), w: 1000, h: 750, fields: { loc: '101동', memo: '배근 검측' } };
  const data = await boardImage(item, '2026-11-17');
  const changed = await boardImage({ ...item, fields: { ...item.fields, memo: '타설 완료' } }, '2026-11-18');
  assert.notDeepEqual(data, changed, 'editing fields changes the exported photograph');
  const image = await loadImage(data);
  assert.equal(image.width, 1000); assert.equal(image.height, 750);
  for (const form of forms()) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildXlsx({ form: form.id, date: '2026-11-17', items: [item] }));
    const photo = wb.media[wb.getWorksheet(form.sheet).getImages()[0].imageId].buffer;
    assert.notDeepEqual(Buffer.from(photo), Buffer.from(item.data, 'base64'), 'Excel embeds the board, not the original image');
    const img = await loadImage(photo), check = createCanvas(img.width, img.height), ctx = check.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const [r, green, b] = ctx.getImageData(330, 730, 1, 1).data;
    assert.ok(r > 240 && green > 240 && b > 240, 'white board exists at the photo bottom left');
  }
  console.log('✓ photo boards: four rows, exact fields, fixed site, photo bounds, long text, edits and Excel images in all four forms');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
