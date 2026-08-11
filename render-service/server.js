/** LibreOffice로 xlsx를 실제 인쇄 모양 그대로 PDF(또는 PNG)로 바꾸는 변환 서버.
 *  Cloud Run에서 요청이 없으면 자동으로 꺼지므로 평소엔 비용이 들지 않는다. */
const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || '';
const COMMAND_TIMEOUT_MS = Math.max(10_000, Number(process.env.COMMAND_TIMEOUT_MS) || 120_000);
const MAX_CONCURRENT_CONVERSIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_CONVERSIONS) || 2);
let activeConversions = 0;

if (!API_KEY) {
  console.error('API_KEY is required; refusing to start an unauthenticated conversion service.');
  process.exit(1);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('요청이 너무 큽니다.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({
      maxBuffer: 1024 * 1024 * 64,
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }, opts), (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').toString().slice(0, 400) || err.message));
      else resolve(stdout);
    });
  });
}

function authorized(req) {
  const supplied = Buffer.from(String(req.headers['x-api-key'] || ''));
  const expected = Buffer.from(API_KEY);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

/** xlsx -> pdf. 동시 요청끼리 프로필이 부딪히지 않도록 매 요청마다 프로필 폴더를 새로 준다. */
async function convertToPdf(xlsxPath, outDir, id) {
  const profileDir = path.join(os.tmpdir(), 'lo-' + id);
  try {
    await run('soffice', [
      '--headless', '--norestore', '--nologo', '--nofirststartwizard', '--nolockcheck',
      '-env:UserInstallation=file://' + profileDir,
      '--convert-to', 'pdf', '--outdir', outDir, xlsxPath,
    ], { env: Object.assign({}, process.env, { HOME: os.tmpdir() }) });
    const base = path.basename(xlsxPath, path.extname(xlsxPath));
    return path.join(outDir, base + '.pdf');
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function pdfToPngs(pdfPath, outPrefix, dpi) {
  await run('pdftoppm', ['-png', '-r', String(dpi), pdfPath, outPrefix]);
  const dir = path.dirname(outPrefix), base = path.basename(outPrefix);
  return fs.readdirSync(dir).filter(f => f.startsWith(base)).sort()
    .map(f => fs.readFileSync(path.join(dir, f)));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  // 어떤 글꼴로 대체되는지 확인용 — 글꼴이 어긋나면 엑셀의 열 너비 계산이 통째로 틀어진다
  if (req.method === 'GET' && req.url.startsWith('/fonts')) {
    const want = ['Calibri', 'Arial', 'Malgun Gothic', '맑은 고딕', 'Gulim', '굴림',
                  'GulimChe', '굴림체', '새굴림', 'Carlito', 'Liberation Sans', 'Noto Sans KR', 'NanumGothic'];
    const out = {};
    for (const f of want) {
      try { out[f] = (await run('fc-match', [f])).toString().trim(); }
      catch (e) { out[f] = 'ERR ' + e.message; }
    }
    try { out._locale = (await run('sh', ['-c', 'echo $LANG; locale 2>&1 | head -3'])).toString().trim(); } catch (e) { /* 무시 */ }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out, null, 1));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/convert') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
    res.end(JSON.stringify({ error: 'conversion service is busy' }));
    return;
  }

  activeConversions++;
  const id = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(os.tmpdir(), 'job-' + id);

  try {
    fs.mkdirSync(workDir, { recursive: true });
    const raw = await readBody(req, 30 * 1024 * 1024);
    const body = JSON.parse(raw.toString('utf8'));
    if (!body.xlsx || typeof body.xlsx !== 'string') throw new Error('xlsx가 없습니다.');

    const xlsx = Buffer.from(body.xlsx, 'base64');
    if (xlsx.length < 4 || xlsx[0] !== 0x50 || xlsx[1] !== 0x4b || xlsx[2] !== 0x03 || xlsx[3] !== 0x04) {
      throw new Error('유효한 XLSX 파일이 아닙니다.');
    }
    if (xlsx.length > 20 * 1024 * 1024) throw new Error('XLSX 파일이 너무 큽니다.');

    const xlsxPath = path.join(workDir, 'in.xlsx');
    fs.writeFileSync(xlsxPath, xlsx);

    const pdfPath = await convertToPdf(xlsxPath, workDir, id);
    if (!fs.existsSync(pdfPath)) throw new Error('PDF 변환에 실패했습니다.');

    let payload;
    if (body.format === 'png') {
      const dpi = Math.min(300, Math.max(72, Number(body.dpi) || 150));
      const pngs = await pdfToPngs(pdfPath, path.join(workDir, 'page'), dpi);
      payload = { pages: pngs.map(b => b.toString('base64')) };
    } else {
      payload = { pdf: fs.readFileSync(pdfPath).toString('base64') };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || String(e) }));
  } finally {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    activeConversions--;
  }
});

server.listen(PORT, () => console.log('render-service listening on', PORT));
