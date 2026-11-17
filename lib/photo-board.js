const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const PhotoBoard = require('../public/photo-board.js');

GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansKR-Regular.ttf'), 'Noto Sans KR');
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansKR-Bold.ttf'), 'Noto Sans KR');

async function boardImage(item, date) {
  const img = await loadImage(Buffer.from(item.data, 'base64'));
  const cv = createCanvas(img.width, img.height), g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0);
  PhotoBoard.draw(g, 0, 0, cv.width, cv.height, item.fields, date, '"Noto Sans KR"');
  return cv.toBuffer('image/jpeg', 92);
}

module.exports = { boardImage, PhotoBoard };
