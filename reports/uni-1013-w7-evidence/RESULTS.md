# W7/W7b evidence: Docs web frame served from apps/web (UNI-1013)

Run 2026-10-08 against a production `next build` of this branch, the Go server
built from this branch (lane dev `280b5f791` merged + the org-scoped mint fix),
Postgres from `.env.worktree`, and the pinned fork build `0.1.0-2953d27`
(clean, fork lane `2953d27`, built with `npm run build:web`).
`office_docs_web` and `office_engine` are enabled by an ORGANIZATION override
(`feature_flag_overrides.scope_type = 'organization'`), not a global one.

Command (from `e2e/`, env from `.env.worktree`):

    OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT \
      PLAYWRIGHT_OUTPUT_DIR=<repo>/reports/uni-1013-w7-evidence/flow \
      flock /home/ubuntu/.uniwork-lane-build.lock \
      pnpm exec playwright test office-docs-web.spec.ts --trace=on

Result: 7 passed.

| # | spec | what it proves |
| --- | --- | --- |
| 1 | frame serving: index.html | pinned CSP (frame-ancestors 'self', no unsafe-eval), X-Frame-Options SAMEORIGIN, nosniff, `max-age=0, must-revalidate`, no `<meta>` CSP |
| 2 | frame serving: assets | `assets/*.js` and `fonts/*` immutable for a year; bytes hash to the manifest sha256 |
| 3 | frame serving: unpinned version | 404 that still carries the locked-down headers |
| 4 | frame serving: boot | the frame boots under its own CSP with zero violations |
| 5 | open, edit, save | sign in -> docx opens in the iframe -> edit -> Ctrl+S -> a new Documents version whose word/document.xml holds the edit -> fresh navigation shows it |
| 6 | save as | File > Save as in the frame -> a copy is created and holds the edit, the page URL follows to the copy, the original gains no version, the next Ctrl+S lands a new version on the copy |
| 7 | flag off | org override off: G3 editor host mounts, no iframe |

Go (`server/`, env from `.env.worktree`): `go test ./internal/handler -run 'TestIsolation|Office'`,
`./internal/handler/router`, `./internal` pass; `TestOfficeFrameFlagIsEvaluatedPerOrganization`
proves an org override opens mint, open, save and refresh, another organization stays closed at
mint, and a token minted while open stops working when its override is switched off.

Screenshots: `screenshots/01-opened-in-frame.png`, `02-saved.png`, `03-reopened.png`,
`04-save-as-copy.png`. Traces for every case: `flow/**/trace.zip` (untracked, regenerate with the command above).
