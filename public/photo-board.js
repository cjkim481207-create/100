/* Shared by the browser preview, PDF renderer and Excel image export. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotoBoard = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SITE_NAME = '구리갈매A-2BL 아파트 건설공사';
  const BOARD_SCALE = 0.6; // 20% larger than the previous 0.5-size board.
  const FONT = '"Malgun Gothic","맑은 고딕","Noto Sans KR",sans-serif';

  function values(fields, date) {
    fields = fields || {};
    return [
      ['현장명', SITE_NAME],
      ['위치', String(fields.loc || '')],
      ['내용', String(fields.memo || '')],
      ['일자', String(fields.date || date || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3')],
    ];
  }

  function wrap(g, text, width) {
    const lines = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (line && g.measureText(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Coordinates describe the visible photograph, excluding the sheet's white padding. */
  function draw(g, x, y, width, height, fields, date, font) {
    if (!(width > 0 && height > 0)) return;
    g.save();
    const bw = Math.min(width * 0.66, height * 1.3);
    const pad = bw * 0.025, labelW = bw * 0.19;
    const rows = values(fields, date);
    let size = bw / 27, layout, bh;
    // Long descriptions wrap and the board stays within the photograph.
    for (let attempt = 0; attempt < 80; attempt++) {
      g.font = `bold ${size}px ${font || FONT}`;
      layout = rows.map(([label, text]) => {
        const lines = wrap(g, text, bw - labelW - pad * 2);
        return { label, lines, h: Math.max(1, lines.length) * size * 1.4 + pad * 2 };
      });
      bh = layout.reduce((sum, row) => sum + row.h, 0);
      if (bh <= height * 0.44) break;
      size *= 0.9;
    }
    const bx = x, by = y + height - bh * BOARD_SCALE;
    g.beginPath(); g.rect(x, y, width, height); g.clip();
    // Scale the entire board together, preserving wrapping and aspect ratio.
    g.translate(bx, by); g.scale(BOARD_SCALE, BOARD_SCALE);
    g.fillStyle = '#fff'; g.fillRect(0, 0, bw, bh);
    g.strokeStyle = '#000'; g.fillStyle = '#000';
    g.lineWidth = Math.max(0.5, bw / 550);
    g.strokeRect(0, 0, bw, bh);
    g.beginPath(); g.moveTo(labelW, 0); g.lineTo(labelW, bh); g.stroke();
    g.textBaseline = 'middle';
    // Use the available row height for larger glyphs without stretching text.
    const text = (value, tx, ty, maxWidth) => {
      let textSize = size * 1.15;
      g.font = `bold ${textSize}px ${font || FONT}`;
      while (g.measureText(value).width > maxWidth && textSize > size) {
        textSize = Math.max(size, textSize * 0.97);
        g.font = `bold ${textSize}px ${font || FONT}`;
      }
      g.fillText(value, tx, ty);
    };
    let top = 0;
    for (let i = 0; i < layout.length; i++) {
      const row = layout[i];
      if (i) { g.beginPath(); g.moveTo(0, top); g.lineTo(bw, top); g.stroke(); }
      g.textAlign = 'center';
      text(row.label, labelW / 2, top + row.h / 2, labelW - pad);
      g.textAlign = 'left';
      row.lines.forEach((line, n) => text(line, labelW + pad, top + pad + size * 0.7 + n * size * 1.4, bw - labelW - pad * 2));
      top += row.h;
    }
    g.restore();
    return { x: bx, y: by, width: bw * BOARD_SCALE, height: bh * BOARD_SCALE };
  }

  return { SITE_NAME, values, draw };
});
