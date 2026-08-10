const { analyzeBuffer } = require('../tools/add-form.js');
const { stripPhotos } = require('../lib/build.js');

// 원본 그대로(바이너리) 받는다. JSON+base64로 감싸면 33% 커져서, 사진이 든 실제
// 현장 파일(3~4MB대)이 Vercel의 요청 크기 한도(4.5MB, 설정으로 못 늘림)를 쉽게 넘는다.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('양식 파일이 너무 큽니다 (10MB까지).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 앱에서 올린 양식 엑셀을 분석해 양식 정의를 돌려준다 (파일 자체는 서버에 저장하지 않는다)
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }
  try {
    const buf = await readRawBody(req, 10 * 1024 * 1024);
    if (!buf.length) throw new Error('양식 파일이 없습니다.');
    const name = decodeURIComponent(req.headers['x-form-name'] || '') || '새 양식';
    const def = await analyzeBuffer(buf, {
      id: 'u' + Date.now().toString(36),
      name,
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
