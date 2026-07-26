const { buildXlsx } = require('../lib/build.js');

module.exports = async (req, res) => {
  if (req.method === 'GET') {          // 앱이 미리 깨워두는 용도
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다.' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const buf = await buildXlsx(body);
    const name = `사진대지_${body.date || ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message || '생성 중 오류가 발생했습니다.' });
  }
};
