const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const source = fs.readFileSync('public/app.js', 'utf8');
  const match = source.match(/function canvasJpeg\(cv, quality\) \{[\s\S]*?\n\}\n\nasync function shrink/);
  assert(match, 'canvasJpeg must be defined immediately before shrink');

  const definition = match[0].replace(/\n\nasync function shrink$/, '');
  const context = {};
  vm.runInNewContext(`${definition}\nglobalThis.canvasJpeg = canvasJpeg;`, context);

  const input = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const canvas = {
    toBlob(callback, type, quality) {
      assert.equal(type, 'image/jpeg');
      assert.equal(quality, 0.8);
      callback(new Blob([input], { type }));
    },
  };
  const output = await context.canvasJpeg(canvas, 0.8);
  assert.deepEqual(Array.from(output), Array.from(input));

  await assert.rejects(
    context.canvasJpeg({ toBlob(callback) { callback(null); } }, 0.8),
    /사진을 JPEG로 변환하지 못했습니다/,
  );

  console.log('client JPEG conversion tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
