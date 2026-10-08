# W7/W7b evidence: Docs web frame served from apps/web (UNI-1013)

Run 2026-10-08 against a production `next build` of this branch, the Go server
built from this branch (dev lane `e2f4d6489`: W5d export wiring + W8 export route + org-scoped mint fix),
Postgres from `.env.worktree`, and the pinned fork build `0.1.0-5bce54c`
(clean, fork lane FINAL `5bce54c`, built with `npm run build:web` in the lane worktree).
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
