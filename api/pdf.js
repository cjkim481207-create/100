const { buildPdf } = require('../lib/draw.js');

module.exports.config = { api: { bodyParser: { sizeLimit: '12mb' } } };

// 앱 화면의 PDF 저장과 같은 그림을 서버에서 만든다 (변환 서버 없이). 요청 모양은 /api/xlsx 와 같다.
// 채팅 봇 등 브라우저가 없는 곳에서 xlsx 와 PDF 를 함께 받아가는 용도.
module.exports = async (req, res) => {
  if (req.method === 'GET') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const buf = await buildPdf(body);
    const name = `사진대지_${body.date || ''}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message || 'PDF 생성 중 오류가 발생했습니다.' });
  }
};
