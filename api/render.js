const ExcelJS = require('exceljs');
const { buildXlsx, forms } = require('../lib/build.js');

module.exports.config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const RENDER_URL = process.env.RENDER_SERVICE_URL;   // Cloud Run 주소 (없으면 이 기능은 꺼진다)
const RENDER_KEY = process.env.RENDER_SERVICE_KEY;

/** LibreOffice 가 엑셀과 다르게 해석하는 서식을, 엑셀이 그리는 모양과 같아지도록 바꾼다.
 *  변환 서버에 보낼 사본에만 적용한다 — 사용자가 내려받는 엑셀 파일은 원본 그대로 둔다.
 *
 *  균등 분할(distributed): 엑셀은 마지막 줄을 펼치지 않으므로(justifyLastLine 기본값 거짓)
 *  한 줄짜리 '일 자', '비 고' 같은 라벨을 가운데로 그린다. LibreOffice 는 칸 좌우 끝까지
 *  쫙 벌려서 자간이 벌어져 보인다. 여러 줄로 접히는 칸은 엑셀도 펼치므로 건드리지 않는다. */
function normalizeForLibreOffice(ws) {
  ws.eachRow({ includeEmpty: true }, row => {
    row.eachCell({ includeEmpty: true }, cell => {
      const a = cell.alignment;
      if (!a || a.horizontal !== 'distributed') return;
      if (a.wrapText) return;                       // 접히는 칸은 엑셀도 펼친다
      cell.alignment = Object.assign({}, a, { horizontal: 'center' });
    });
  });
}

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
    normalizeForLibreOffice(keep);
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
