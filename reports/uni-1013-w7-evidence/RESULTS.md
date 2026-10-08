# W7 evidence: Docs web frame served from apps/web (UNI-1013)

Run 2026-10-08 against a production `next build` of this branch (pin
`0.1.0-93881c5`, a clean fork build from the W1 branch merged with the lane head
`425edd9`), the Go server from this branch (with W6's uncommitted
`office_frame.go` OpenAPI example fix, see the report) and Postgres from
`.env.worktree`.

Command (from `e2e/`, env from `.env.worktree`):

    OFFICE_DOCS_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT \
      PLAYWRIGHT_OUTPUT_DIR=<repo>/reports/uni-1013-w7-evidence/flow \
      flock /home/ubuntu/.uniwork-lane-build.lock \
      pnpm exec playwright test office-docs-web.spec.ts --trace=on

Result: 6 passed.

| # | spec | what it proves |
| --- | --- | --- |
| 1 | frame serving: index.html headers | pinned CSP (frame-ancestors 'self', no unsafe-eval), X-Frame-Options SAMEORIGIN, nosniff, `max-age=0, must-revalidate`, no `<meta>` CSP |
| 2 | frame serving: assets | `assets/*.js` and `fonts/*` immutable for a year; served bytes hash to the manifest sha256 |
| 3 | frame serving: unpinned version | 404 that still carries the locked-down headers |
| 4 | frame serving: boot | the frame boots under its own CSP with zero violations |
| 5 | open, edit, save | sign in -> docx opens in the iframe -> type a marker -> Ctrl+S -> a new Documents version exists and its word/document.xml holds the marker -> fresh navigation shows the marker |
| 6 | flag off | `office_docs_web` off: G3 editor host mounts, no iframe |

Screenshots: `screenshots/01-opened-in-frame.png`, `02-saved.png`,
`03-reopened.png`. Playwright traces for every case are in `flow/**/trace.zip`
(untracked, 9 MB; regenerate with the command above).
