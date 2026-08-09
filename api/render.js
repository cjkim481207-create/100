const ExcelJS = require('exceljs');
const { buildXlsx, forms } = require('../lib/build.js');

module.exports.config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const RENDER_URL = process.env.RENDER_SERVICE_URL;   // Cloud Run 주소 (없으면 이 기능은 꺼진다)
const RENDER_KEY = process.env.RENDER_SERVICE_KEY;

// 사진대지 xlsx를 실제 엑셀 엔진(LibreOffice)으로 렌더한 PDF/PNG를 돌려준다.
// 화면 미리보기는 이걸 흉내 낸 그림이라 다를 수 있지만, 여기서 나온 결과는 곧 인쇄 결과 그 자체다.
module.exports = async (req, res) => {
  if (req.method === 'GET') { res.status(200).json({ ok: !!RENDER_URL }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  if (!RENDER_URL) { res.status(503).json({ error: '변환 서버가 설정되지 않았습니다.' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const xlsxBuf = await buildXlsx(body);

    // 관련 시트 하나만 남긴다. 원본 통합문서에 다른 시트가 섞여 있으면(예: 7시트짜리 보고서)
    // 그 시트들까지 그대로 인쇄돼 버린다.
    const form = body.formDef || forms().find(f => f.id === body.form) || forms()[0];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuf);
    const keep = (form.sheet && wb.getWorksheet(form.sheet)) || wb.worksheets[0];
    for (const ws of [...wb.worksheets]) if (ws.id !== keep.id) wb.removeWorksheet(ws.id);
    const trimmed = Buffer.from(await wb.xlsx.writeBuffer());

    const format = body.format === 'png' ? 'png' : 'pdf';
    const r = await fetch(RENDER_URL.replace(/\/$/, '') + '/convert', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, RENDER_KEY ? { 'x-api-key': RENDER_KEY } : {}),
      body: JSON.stringify({ xlsx: trimmed.toString('base64'), format, dpi: body.dpi || 150 }),
    });
    if (!r.ok) throw new Error('변환 서버 오류: ' + (await r.text()).slice(0, 300));
    const out = await r.json();
    if (out.error) throw new Error(out.error);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.status(200).send(Buffer.from(out.pdf, 'base64'));
    } else {
      res.status(200).json({ pages: out.pages });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || '변환 중 오류가 발생했습니다.' });
  }
};
