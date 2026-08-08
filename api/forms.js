const { forms } = require('../lib/build.js');

// 앱이 양식 목록·치수를 받아가는 곳 (미리보기와 PDF도 같은 정의를 쓴다)
module.exports = (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json(forms());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
