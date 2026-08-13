import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const base = option('--base', 'https://100-one-mocha.vercel.app').replace(/\/$/, '');
const imagePath = option('--image');
const outputDir = path.resolve(option('--out', path.join('tmp', 'photo-daeji-production-check')));
if (!imagePath) throw new Error('Provide a normal JPEG with --image <photo.jpg>.');

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('The production test image must be a JPEG.');
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  for (let index = 2; index + 9 < buffer.length;) {
    if (buffer[index] !== 0xff) { index++; continue; }
    const marker = buffer[index + 1];
    if (marker === 0xd8 || marker === 0xd9) { index += 2; continue; }
    const length = buffer.readUInt16BE(index + 2);
    if (sof.has(marker)) return { height: buffer.readUInt16BE(index + 5), width: buffer.readUInt16BE(index + 7) };
    if (length < 2) break;
    index += 2 + length;
  }
  throw new Error('Could not read JPEG dimensions.');
}

async function get(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response;
}

async function post(endpoint, body) {
  const response = await fetch(base + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${endpoint} ${response.status}: ${bytes.toString('utf8', 0, 500)}`);
  return { response, bytes };
}

const jpeg = await fs.readFile(path.resolve(imagePath));
const { width, height } = jpegSize(jpeg);
const data = jpeg.toString('base64');
await fs.mkdir(outputDir, { recursive: true });

const forms = await (await get(`${base}/api/forms?guard=${Date.now()}`)).json();
const expectedIds = ['daeji2', 'jaejae', 'jangbi', 'yongyeok'];
const actualIds = forms.slice(0, 4).map(form => form.id);
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error(`Built-in form order mismatch: ${actualIds.join(',')}`);
}

const health = await (await get(`${base}/api/render?guard=${Date.now()}`)).json();
if (health.ok !== true) throw new Error(`Render service is not ready: ${JSON.stringify(health)}`);
const app = await (await get(`${base}/app.js?guard=${Date.now()}`)).text();
for (const required of ['function canvasJpeg(cv, quality)', "new Set(['daeji2', 'jaejae', 'jangbi', 'yongyeok'])"]) {
  if (!app.includes(required)) throw new Error(`Deployed app.js is missing: ${required}`);
}

const cases = [
  ['daeji2', 1, 1],
  ['jaejae', 1, 1],
  ['jaejae', 3, 2],
  ['jangbi', 1, 1],
  ['jangbi', 3, 2],
  ['yongyeok', 1, 1],
];

for (const [form, count, expectedPages] of cases) {
  const item = { width, height, w: width, h: height, data, fields: { date: '2026-08-11', memo: `release guard ${count}` } };
  const body = { form, site: 'production release guard', date: '2026-08-11', items: Array.from({ length: count }, () => item) };
  if (form === 'daeji2') {
    body.formDef = { ...forms.find(entry => entry.id === form), loColWidthFix: 9, loRowHeightFix: 9, pageSetup: {} };
    body.template = Buffer.from('stale built-in browser template').toString('base64');
  }
  const stem = `${form}-${count}`;

  const xlsx = (await post('/api/xlsx', body)).bytes;
  if (xlsx.subarray(0, 2).toString() !== 'PK') throw new Error(`${stem}: invalid XLSX magic`);
  await fs.writeFile(path.join(outputDir, `${stem}.xlsx`), xlsx);

  const pdf = (await post('/api/render', { format: 'pdf', ...body })).bytes;
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error(`${stem}: invalid PDF magic`);
  await fs.writeFile(path.join(outputDir, `${stem}.pdf`), pdf);

  const pngResult = JSON.parse((await post('/api/render', { format: 'png', dpi: 100, ...body })).bytes.toString('utf8'));
  if (!Array.isArray(pngResult.pages) || pngResult.pages.length !== expectedPages) {
    throw new Error(`${stem}: expected ${expectedPages} PNG pages, received ${pngResult.pages?.length}`);
  }
  for (let index = 0; index < pngResult.pages.length; index++) {
    await fs.writeFile(path.join(outputDir, `${stem}-page-${index + 1}.png`), Buffer.from(pngResult.pages[index], 'base64'));
  }
  console.log(JSON.stringify({ form, photos: count, pages: pngResult.pages.length, xlsxBytes: xlsx.length, pdfBytes: pdf.length }));
}

console.log(`\nProduction checks passed. Visually inspect every PNG in: ${outputDir}`);
