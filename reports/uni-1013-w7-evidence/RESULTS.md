# W7/W7b evidence: Docs web frame served from apps/web (UNI-1013)

Run 2026-10-09 (re-pin, lane F10) against the pinned fork build `0.1.0-8f34ddf` (fork lane = bd87597 + F11 fix 'hand opened document bytes to the renderer without fetch(blob:)'), dev SHA `63cf4aa19`, on top of the earlier run 2026-10-08 against a production `next build` of this branch, the Go server
built from this branch (dev lane `1b1d5d9b3` (F3a server fixes, W8 export route) merged),
Postgres from `.env.worktree`, and the pinned fork build `0.1.0-5a81008`
(clean, fork lane `5a81008` (headless entry; protocol files unchanged since `5bce54c`), built with `npm run build:web` in the lane worktree).
`office_docs_web` and `office_engine` are enabled by an ORGANIZATION override
(`feature_flag_overrides.scope_type = 'organization'`), not a global one.

Command (from `e2e/`, env from `.env.worktree`):

    OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT \
      PLAYWRIGHT_OUTPUT_DIR=<repo>/reports/uni-1013-w7-evidence/flow \
      flock /home/ubuntu/.uniwork-lane-build.lock \
      pnpm exec playwright test office-docs-web.spec.ts --trace=on

Result: installed bundle 10 passed + 1 skipped; bundle absent 1 passed + 10 skipped (see "Two states").

| # | spec | what it proves |
| --- | --- | --- |
| 1 | frame serving: index.html | pinned CSP (frame-ancestors 'self', no unsafe-eval), X-Frame-Options SAMEORIGIN, nosniff, `max-age=0, must-revalidate`, no `<meta>` CSP |
| 2 | frame serving: assets | `assets/*.js` and `fonts/*` immutable for a year; bytes hash to the manifest sha256 |
| 3 | frame serving: unpinned version | 404 that still carries the locked-down headers |
| 4 | frame serving: boot | the frame boots under its own CSP with zero violations |
| 5 | open, edit, save | sign in -> docx opens in the iframe -> edit -> Ctrl+S -> a new Documents version whose word/document.xml holds the edit -> fresh navigation shows it |
| 6 | save as | File > Save as in the frame -> a copy is created and holds the edit, the page URL follows to the copy, the original gains no version, the next Ctrl+S lands a new version on the copy |
| 7 | inserted image | Chèn > Hình ảnh in the frame: the image renders (naturalWidth > 0) with zero CSP violations, and after Ctrl+S the stored docx holds `word/media/*` |
| 8 | PDF export | see "Export outcome" below |
| 9 | feature_disabled mint | the mint answers 403 `feature_disabled` while the page's config says on -> G3 editor, no iframe, no "document gone" text |
| 10 | flag off | org override off: G3 editor host mounts, no iframe |

Go (`server/`, env from `.env.worktree`): `go test ./internal/handler -run 'TestIsolation|Office'`,
`./internal/handler/router`, `./internal` pass; `TestOfficeFrameFlagIsEvaluatedPerOrganization`
proves an org override opens mint, open, save and refresh, another organization stays closed at
mint, and a token minted while open stops working when its override is switched off.

Screenshots: `screenshots/01-opened-in-frame.png`, `02-saved.png`, `03-reopened.png`,
`04-save-as-copy.png`, `05-image-inserted.png`, `06-bundle-not-installed-g3.png`. Traces for every case: `flow/**/trace.zip` (untracked, regenerate with the command above).

## Export outcome (step 8)

**Not a real PDF here: 503 `office_not_configured` -> in-frame print fallback.** This local stack has no office
engine (`OFFICE_ENGINE_URL` unset, so no Chromium renderer and no `UNIWORK_DOCS_PDF_ASSETS`).
`POST /api/v1/office-frame/documents/{id}/export/pdf` answers 503 `office_not_configured`; the frame receives a typed
`unsupported`, prints in place (status line "Đã xuất PDF: docs-web.pdf (browser print dialog)", `window.print` called once)
and the action resolves. The spec asserts `%PDF-` instead when the route answers 200, so the same step proves a real PDF
on a stack with the renderer. A fix was needed to get here: core mapped only 501 to `unsupported`, so the 503 made the
frame's export hang; `docsFrameError` now maps 503 `office_not_configured` like 501 (test in `docs-frame-api.test.ts`).
The web build has no menu entry for PDF export, so the step calls the renderer's `window.__exportPdf` action (print is
stubbed because a headless run has no print dialog).

## Image upload (`api.images.upload`)

The frame never calls `api.images.upload`: it embeds inserted images as `data:` URIs inside the docx (the bridge has no
caller for it; only the protocol and the host proxy define it). So no asset URL is ever loaded by the frame and the
`img-src` question for the signed asset URL does not arise here; step 7 proves the path the frame really uses
(`data:` under `img-src 'self' data: blob:`, persisted in `word/media/`). The host-side `uploadImage` is covered by core
unit tests only.

## Two states (review follow-up F3b)

The spec picks its cases from `GET <frame>/manifest.json`:

- **Installed** (`flow/`): headers, open/edit/save/reopen, save as, image, export, feature_disabled fallback, flag off: 10 passed.
- **Not installed** (`not-installed/`, the web app built with `public/office-frame` moved away and `OFFICE_FRAME_SOURCE` empty):
  with `office_docs_web` ON for the organization the docx still opens in the G3 editor and no iframe is mounted
  (`screenshots/06-bundle-not-installed-g3.png`): 1 passed. Before this change the page offered the pinned frame and got a 404 iframe.

CI (`e2e` job) sets `OFFICE_DOCS_WEB_E2E=1`; with the `OFFICE_FRAME_SOURCE` secret it runs the installed cases, without it the not-installed one.

## Engine real render on the pinned bundle (5a81008)

`apps/office-engine` `docs-pdf.test.ts` against `apps/web/public/office-frame/docs/0.1.0-5a81008` (the pinned build),
chromium headless-shell 1234: simple 1 page, kitchen-sink 1, long 34 (the desktop counts), 1.6 / 1.6 / 2.3 s per document;
details in `docs/office/pdf-export-decision.md`. The e2e export step still ends in the 503 -> in-frame print fallback because
this local stack runs no office engine.

Re-run 2026-10-09 after merging dev lane `1b1d5d9b3`: installed 10 passed / 1 skipped, not installed 1 passed / 10 skipped.

## Re-pin 2026-10-09: fork 0.1.0-8f34ddf (dev `63cf4aa19`)

`office_docs_web` is ON by default; only the flag-off case writes an ORGANIZATION override (and restores it).
Production `next build` + `next start`, Go server from this branch, both runs under the shared build flock.

- Installed bundle (`0.1.0-8f34ddf`): **10 passed, 1 skipped** (the not-installed case).
- Bundle not installed (`public/office-frame` moved away, `OFFICE_FRAME_SOURCE` empty): **1 passed, 10 skipped**.
- Pin `bd87597` was not usable (blob: URL vs frame CSP) and was never accepted as evidence.
- The fork menu renamed Save as from "Lưu thành…" to "Lưu dưới dạng…"; `e2e/office-docs-web.spec.ts` follows it (first run on 8f34ddf: 9 passed, this one case failed on the label only; re-run all green).
- Vendored protocol files are byte-identical to fork `web/docs/protocol/{types,endpoint,host}.ts` at 8f34ddf (import specifiers aside); only the SHA header comments moved.
- Screenshots refreshed in `screenshots/` (01-06).
