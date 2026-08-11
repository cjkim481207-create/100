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
    execFile(cmd, args, Object.assign({ maxBuffer: 1024 * 1024 * 64 }, opts), (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').toString().slice(0, 400) || err.message));
      else resolve(stdout);
    });
  });
}

/** xlsx -> pdf. 동시 요청끼리 프로필이 부딪히지 않도록 매 요청마다 프로필 폴더를 새로 준다. */
async function convertToPdf(xlsxPath, outDir, id) {
  const profileDir = path.join(os.tmpdir(), 'lo-' + id);
  await run('soffice', [
    '--headless', '--norestore', '--nologo', '--nofirststartwizard', '--nolockcheck',
    '-env:UserInstallation=file://' + profileDir,
    '--convert-to', 'pdf', '--outdir', outDir, xlsxPath,
  ], { env: Object.assign({}, process.env, { HOME: os.tmpdir() }) });
  fs.rmSync(profileDir, { recursive: true, force: true });
  const base = path.basename(xlsxPath, path.extname(xlsxPath));
  return path.join(outDir, base + '.pdf');
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
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const id = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(os.tmpdir(), 'job-' + id);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const raw = await readBody(req, 30 * 1024 * 1024);
    const body = JSON.parse(raw.toString('utf8'));
    if (!body.xlsx) throw new Error('xlsx가 없습니다.');

    const xlsxPath = path.join(workDir, 'in.xlsx');
    fs.writeFileSync(xlsxPath, Buffer.from(body.xlsx, 'base64'));

    const pdfPath = await convertToPdf(xlsxPath, workDir, id);
    if (!fs.existsSync(pdfPath)) throw new Error('PDF 변환에 실패했습니다.');

    let payload;
    if (body.format === 'png') {
      const pngs = await pdfToPngs(pdfPath, path.join(workDir, 'page'), body.dpi || 150);
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
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

server.listen(PORT, () => console.log('render-service listening on', PORT));
