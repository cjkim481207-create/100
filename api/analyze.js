const { analyzeBuffer } = require('../tools/add-form.js');

// 앱에서 올린 양식 엑셀을 분석해 양식 정의를 돌려준다 (파일 자체는 서버에 저장하지 않는다)
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body.data) throw new Error('양식 파일이 없습니다.');
    const def = await analyzeBuffer(Buffer.from(body.data, 'base64'), {
      id: body.id || 'u' + Date.now().toString(36),
      name: body.name || '새 양식',
      sheet: body.sheet,
      start: body.start,
      block: body.block,
    });
    def.custom = true;
    res.status(200).json(def);
  } catch (e) {
    res.status(400).json({ error: e.message || '양식을 인식하지 못했습니다.' });
  }
};
