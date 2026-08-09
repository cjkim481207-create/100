const { analyzeBuffer } = require('../tools/add-form.js');
const { stripPhotos } = require('../lib/build.js');

module.exports.config = { api: { bodyParser: { sizeLimit: '12mb' } } };

// 앱에서 올린 양식 엑셀을 분석해 양식 정의를 돌려준다 (파일 자체는 서버에 저장하지 않는다)
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body.data) throw new Error('양식 파일이 없습니다.');
    const buf = Buffer.from(body.data, 'base64');
    const def = await analyzeBuffer(buf, {
      id: body.id || 'u' + Date.now().toString(36),
      name: body.name || '새 양식',
      sheet: body.sheet,
      start: body.start,
      block: body.block,
    });
    def.custom = true;
    // 올린 파일이 지난달에 다 쓴 보고서인 경우가 많다. 사진칸의 옛 사진을 걷어낸
    // '빈 양식'을 함께 돌려주고, 앱은 원본 대신 이것을 저장해 쓴다.
    const clean = await stripPhotos(buf, def);
    res.status(200).json({ def, template: clean.buffer.toString('base64'), removed: clean.removed });
  } catch (e) {
    res.status(400).json({ error: e.message || '양식을 인식하지 못했습니다.' });
  }
};
