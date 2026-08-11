# Photo Daeji Architecture

## Output paths

| Output | Main files | Rule |
|---|---|---|
| Browser preview and tabs | `public/app.js`, `public/index.html` | Device state must never remove the four built-ins. |
| XLSX download | `api/xlsx.js`, `lib/build.js`, `templates/*.xlsx`, `templates/forms.json` | Preserve the Excel-authored form and page setup. |
| PDF and precise preview | `api/render.js`, `lib/build.js`, `render-service/server.js` | Modify a temporary XLSX copy, then render with LibreOffice. |
| Uploaded custom forms | `api/analyze.js`, `tools/add-form.js`, IndexedDB client storage | Store form definition and stripped template together. |

Do not infer correctness in one path from another. A good preview does not prove XLSX or PDF correctness, and a good XLSX does not prove LibreOffice pagination.

## Built-in form contract

The permanent order and IDs are:

1. `daeji2` - 사진대지
2. `jaejae` - 자재 사진대지
3. `jangbi` - 현장정리비 업체 사진대지
4. `yongyeok` - 용역 사진대지

Render these in a fixed wrapping row. Render user-added forms in a separate horizontally scrollable row. Ignore and repair legacy `hiddenForms` entries for built-in IDs. Never expose deletion for a built-in form.

## XLSX generation contract

`buildXlsx()` owns downloaded workbooks. It must:

- load the original form;
- remove prior photos without removing logos;
- retain all meaningful cell values and styles when cloning blocks;
- insert photos with correct aspect ratio and anchors;
- trim unused trailing rows;
- extend only the print area required for generated blocks;
- preserve the author-controlled page setup.

Run `tools/check.js` against every built-in template after structural changes.

## PDF conversion contract

`api/render.js` builds the same XLSX, hides non-target sheets, applies `normalizeForLibreOffice()` to that temporary copy, and sends it to the render service.

Use per-form settings in `forms.json`:

- `loColWidthFix`
- `loRowHeightFix`
- `loFitToPages`
- `loPdfScale`

`jaejae` and `jangbi` require measured scale mode plus manual block breaks. Their Excel files intentionally remain unchanged. One block must occupy one A4 page in the PDF copy.

## Known regressions

| Symptom | Mechanism | Required guard |
|---|---|---|
| `canvasJpeg is not defined` | Canvas fallback removal also deleted a helper still used by `shrink()` | Run `test:client`; keep a success and null-blob test. |
| One-photo PDF becomes four pages | LibreOffice ignores inactive fit values and spills right/bottom areas into a 2x2 grid | Use per-form measured PDF scale; assert 1 photo = 1 page. |
| Repeated form splits between pages | Fit-to-N-pages divides through a block because only the first block has a document header | Use scale mode with manual breaks at block boundaries; assert 3 photos = 2 pages and inspect both. |
| Tabs differ by device | Local `hiddenForms` or scrolled custom tabs remove built-ins from view | Keep built-ins immutable and in a separate wrapping row; run `test:fixed-tabs`. |
| PDF looks valid after renderer failure | Client silently creates a different canvas PDF | Surface the renderer error; never use an unlabelled fallback. |
| New form changes every existing PDF | Global LibreOffice calibration or page overrides | Store and apply calibration per form only. |

## Deployment surfaces

- Git branch: use the current checked-out branch; never force-push unless explicitly authorized.
- Vercel project: `100`.
- Production alias: `https://100-one-mocha.vercel.app`.
- Render health: `GET /api/render` must return `{ "ok": true }`.
- Forms health: `GET /api/forms` must return all four built-in IDs in order.
