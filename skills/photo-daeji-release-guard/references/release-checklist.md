# Release Checklist

## Before editing

- Record the current branch, HEAD, and worktree changes.
- Reproduce the issue with the affected form and exact photo count.
- Save production PDF/PNG evidence when the bug is rendering-related.
- Decide whether the defect belongs to preview, XLSX, PDF normalization, render service, or device-local tab state.

## Before committing

- Run `node skills/photo-daeji-release-guard/scripts/verify-repo.mjs --repo .`.
- Confirm `git diff --check` passes.
- Inspect the full diff and exclude credentials, `.vercel`, `.env*`, and temporary artifacts.
- Confirm downloaded XLSX behavior remains unchanged for PDF-only fixes.
- Confirm the four built-in IDs remain fixed and ordered.

## Deployment

- Commit with a symptom-oriented message.
- Push the current branch without force.
- Run `npx vercel --prod --yes`.
- Require `readyState: READY` and the production alias assignment.

## Production acceptance

Use a normal JPEG and run:

```text
node skills/photo-daeji-release-guard/scripts/verify-production.mjs --base https://100-one-mocha.vercel.app --image <photo.jpg> --out <temporary-output-dir>
```

Require all of the following:

- `/api/forms` returns `daeji2, jaejae, jangbi, yongyeok` first and in order.
- `/api/render` returns `ok: true`.
- Deployed `app.js` contains `canvasJpeg` and the fixed built-in ID set.
- Every XLSX response has ZIP magic `PK`.
- Every PDF response has `%PDF-` magic.
- `daeji2` with 1 photo: 1 PNG page.
- `jaejae` with 1 photo: 1 PNG page.
- `jaejae` with 3 photos: 2 PNG pages.
- `jangbi` with 1 photo: 1 PNG page.
- `jangbi` with 3 photos: 2 PNG pages.
- `yongyeok` with 1 photo: 1 PNG page.

Open every PNG. Reject the release for clipped borders, extra sliver pages, split rows, missing headers, distorted photos, black photos, or unexpected sheets.

## Closeout

- Delete temporary XLSX, PDF, PNG, and test photos.
- Re-run local tests.
- Require a clean `git status --short`.
- Report the final commit, production URL, tested matrices, and any remaining limitation.
