---
name: photo-daeji-release-guard
description: Maintain, test, and release the photo-daeji Vercel app without regressions. Use for changes involving built-in or uploaded Excel forms, XLSX generation, LibreOffice PDF conversion, previews, photo compression or sharing, fixed form tabs, Cloud Run rendering, GitHub pushes, or Vercel production deployments in the 100 repository.
---

# Photo Daeji Release Guard

Protect the three independent output paths - browser preview, XLSX, and LibreOffice PDF - and verify the deployed result with real files before declaring success.

## Required workflow

1. Read [references/architecture.md](references/architecture.md) before editing code.
2. Inspect `git status`, preserve unrelated user changes, and identify which output path is broken.
3. Reproduce the failure with the exact form, photo count, and production endpoint when available.
4. Make the smallest layer-specific fix. Never alter XLSX page settings to repair a PDF-only problem.
5. Run `node skills/photo-daeji-release-guard/scripts/verify-repo.mjs --repo .`.
6. Read and complete [references/release-checklist.md](references/release-checklist.md).
7. Commit intentionally, push the current branch, and deploy with `npx vercel --prod --yes` only when deployment is authorized.
8. Run `node skills/photo-daeji-release-guard/scripts/verify-production.mjs --base https://100-one-mocha.vercel.app --image <real-photo.jpg> --out <temporary-output-dir>`.
9. Open every generated PNG and visually confirm full borders, undistorted photos, intact page boundaries, and expected blank slots.
10. Remove temporary outputs and require a clean worktree before reporting completion.

## Non-negotiable invariants

- Keep built-in form IDs `daeji2`, `jaejae`, `jangbi`, and `yongyeok` first, fixed, visible, and immune to device-local hide/delete state.
- Keep user-added forms separate from the built-in row and deduplicate IDs.
- Preserve downloaded XLSX formatting, print area, orientation, margins, formulas, values, dates, rich text, hyperlinks, and page breaks.
- Apply LibreOffice calibration only to the PDF conversion copy and only through per-form metadata.
- Keep `canvasJpeg` defined and tested wherever `shrink()` calls it.
- Never silently replace a failed precise PDF conversion with a canvas PDF.
- Treat one real photo in `jaejae` or `jangbi` as exactly one PDF page; treat three photos as exactly two intact form pages.
- Use a valid, ordinary JPEG for final tests. Do not rely only on a corrupt, header-only, or 1x1 synthetic image.
- Verify production artifacts after deployment. Local tests and a Vercel `READY` status are necessary but insufficient.

## Failure rules

- Do not claim success when only endpoint health checks pass.
- Do not accept the correct page count without visual inspection; a page can still split a form or distort a photo.
- Do not use global LibreOffice width, height, scale, paper, or orientation overrides to fix one form.
- Do not delete or hide a built-in form as a substitute for repairing device-local state.
- Stop and report the exact failed case when a required production artifact cannot be generated or inspected.

## Resources

- Run `scripts/verify-repo.mjs` for deterministic local regression checks.
- Run `scripts/verify-production.mjs` after every production deployment that touches forms, rendering, tabs, photos, downloads, or sharing.
- Consult `references/architecture.md` for data flows, ownership, and known failure mechanisms.
- Consult `references/release-checklist.md` for release gates and acceptance criteria.
