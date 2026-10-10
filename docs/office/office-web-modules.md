# Office web modules: PDF, Markdown, HTML, Slides, Sheets in the web frame (UNI-1014/1015/1016)

The Docs web frame (`docs/office/docs-web-frame.md`, UNI-1013) is generalised to
every genoffice module. There is one protocol, one frame host, one set of
`/api/v1/office-frame/*` routes and one sync script; each of them takes a
module. Docs keeps every name, URL, pin and test it had.

| module | format | flag (default on) | issue |
| --- | --- | --- | --- |
| `docs` | docx | `office_docs_web` | UNI-1013 |
| `pdf` | pdf | `office_pdf_web` | UNI-1014 |
| `markdown` | md | `office_markdown_web` | UNI-1014 |
| `html` | html | `office_html_web` | UNI-1014 |
| `slides` | pptx | `office_slides_web` | UNI-1015 |
| `sheets` | xlsx | `office_sheets_web` | UNI-1016 |

Every module flag is on by default since 2026-10-09 (user decision, lane
CONTRACT C14); an organization or user override turns a module off, and a
module whose bundle is not installed and verified opens in the G3 host
whatever its flag says. xls, odt and every other format have no web module
and keep the G3 host (or its unsupported state).

## Server: the module is in the token

- `POST /api/v1/documents/{id}/office/frame-token` derives the module from the
  document's stored file, never from the client
  (`server/internal/service/office_frame_module.go`: a DOCX keeps the Docs
  rule, mime or `.docx`; any other format is judged as the Office editor
  judges it, extension first, then the verified content type). A format with
  no module answers 404 as before; a module whose flag is off for the
  document's organization answers 403 `feature_disabled`, as Docs always did.
- The token carries the module as claim `m`. Docs tokens carry none, so a
  token minted before modules existed is still valid and still means docs; an
  explicit `"m":"docs"` or an unknown module is refused.
- Every frame route evaluates the flag of the token's module, for the token's
  organization, inside the frame-auth middleware (only the token names the
  module): off answers 404 `feature_disabled`, the same answer the old
  route-level `office_docs_web` gate gave. A Docs token cannot pass on the
  PDF flag and the other way round. A signed image URL (`?sig=`) carries the
  token's `m` too, so the byte route checks the same module's flag.
- The open, mint and commit answers carry `module`; the host refuses a minted
  module that differs from the frame it mounts (`malformed`, G3 fallback).
- `Authorize` refuses a token whose document's current version is no longer of
  the token's module (404), and recents list only the token's module.
- The routes stay generic (open, content, uploads, commit, recents, assets).
  `export/pdf` is the Docs renderer and answers 501 `unsupported_operation`
  to any other module's token; the frame prints in place.
- Mint and open answers carry `module`.

## Bundles, pins, sync, headers (`apps/web`)

- One pin per module: `apps/web/platform/office-frame/<module>.pin.json`
  (`docs.pin.json` unchanged; the other modules have none until their worker
  pins a build). The manifest may name its `module`; absent is docs, and a
  build is refused for a module it does not name.
- `office-frame-sync.mjs`: `--module <m>` (default docs), `--all` (every pinned
  module; with `--pin`, every module present in the source), `--check` takes
  the same selection, and `--ensure` (the `pnpm build` / `pnpm dev` hook)
  checks every pinned module and syncs the missing ones. `OFFICE_FRAME_SOURCE`
  may be a dist-web root holding `<module>/<version>/` (the fork's
  `build:web:all`, or a `.tar.gz` of it), one module's directory (the docs-only
  layout of UNI-1013 keeps working), or a version directory.
- Installs go to `public/office-frame/<module>/<version>/`, served at
  `/office-frame/<module>/<version>/index.html`.
- Headers: every `/office-frame/**` path first gets the locked-down policy
  (`default-src 'none'; frame-ancestors 'self'`); each module's rule follows
  and gives `/office-frame/<module>/**` that module's pinned CSP and extra
  headers (Next applies matching rules in order and the last value of a header
  wins), with the same caching split per module. One module's pin never
  reaches another module's paths.
- A document of a bundle with its own policy (`documents`): the html module's
  `preview.html` runs the previewed page's scripts, so the fork serves it with
  a sandboxed, opaque-origin CSP of its own (fork 2a3725b, `csp.json`
  `documents[{path, value, directives}]`; the frame's own policy only gains
  `frame-src 'self'`). The pin carries them as an optional
  `documents: [{path, value}]` (a pin without any keeps its shape, docs.pin.json
  is unchanged), the sync verifies them like the headers (`--pin` records them,
  a changed or dropped one fails the check until a deliberate re-pin), and
  `officeFrameHeaderRules` adds one rule after the module's own,
  `/office-frame/<module>/:version/<path>`, with that policy instead of the
  module's (X-Frame-Options, nosniff and the referrer policy stay the host's).
  The host refuses to pin or serve a document policy that is not the
  sandboxed kind: it needs a `sandbox` without `allow-same-origin`, top
  navigation or escaping popups, `default-src`, `connect-src` and `form-action`
  `'none'`, no `'self'` (only `frame-ancestors 'self'`, forced), an exact
  file path other than `index.html`, and the manifest must list the file.
  Tests: `frame-bundle.test.ts`, `frame-install.test.ts`,
  `frame-headers.test.ts`.
- `next.config.mjs` inlines `NEXT_PUBLIC_OFFICE_FRAME_VERSIONS`, a JSON map of
  the modules whose pinned bundle is installed and verifies, and keeps
  `NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION` for docs.

## Host (`packages/views/office/frame`, `apps/web/platform`)

- `OfficeModuleFrame` (frame src, the module's default API, the expected
  module) and `OfficeModuleOpenSwitch` (the module's flag, refusal fallback)
  are the generic pieces; `OfficeDocsFrame` and `DocxOpenSwitch` are wrappers
  for docs.
- The vendored host is given the module: a frame whose `ready.module` differs
  fails the handshake with `malformed` before any `init`, and `init.module`
  names it. A Docs bundle from before the field says no module, which is docs.
- Capabilities come from one table, `officeModuleSpec(module).grant` in
  `packages/core/office/office-modules.ts`, narrowed by readonly and by the
  API. Docs keeps its UNI-1013 grant. pdf, slides, sheets: save, save-as,
  print; markdown, html: also exportHtml. Recents, file pick and attachments
  stay off outside Docs and only Docs has the server PDF export.
- Images (markdown/html): off, and `open.assets` is not filled. The G3 web
  host does not resolve relative images either (its image port is unwired,
  the engine manifest carries no asset ids, and the preview asset proxy is a
  separate origin the frame's `img-src 'self' data: blob:` could not load),
  and it has no paste upload. When G3 gains them, fill `open.assets` with
  same-origin URLs or `data:` URIs and grant `images` with an upload handler
  over the asset routes.
- `init.user = {displayName}` is the signed-in user's display name, for every
  module including Docs (comment and note authors). Display data only.
- View-only: a user who may view but not edit (the page's `readonly`, or
  outside Docs the minted token's `can_edit: false`) gets the frame without
  save / save-as. Slides is the exception (`viewOnlyInG3`): a view-only user
  opens the G3 pptx host. Docs view-only behaviour is unchanged from UNI-1013
  (open item: it does not read the token's `can_edit`).
- `createOfficeFrameApi(module)` is the API over the same routes: a save
  uploads the module's mime type under the stored name, a save-as appends the
  module's extension, and only docs has `export`.
- `platform/office/document-office-host.tsx` is browser-isolated
  (`scripts/office/check-boundaries.mjs`), so the app layer injects the frame
  into it: `createDocumentOfficeEditorHost({ moduleForFormat, Frame })`, and
  `platform/office-frame/document-host.tsx` supplies both (the format-to-module
  table, and `PinnedFrame`, which reads the pins and the workspace routes).
  Every format with a module goes through `Frame` with its G3 host as the
  fallback; `PinnedFrame` renders the fallback alone, asking no flag, when
  `pinnedFrameVersion(module)` is empty, so without an installed bundle the
  existing G3 host renders exactly as before.

## Open in desktop app (GD3)

Every module frame, Docs included, carries the G3 editor's "Open in desktop
app" split button (`DesktopOpenAction`: launch session + `uniwork://` deep
link + installer menu) in the page header's action cluster. One rule for both
hosts, `apps/web/platform/office/desktop-open-props.ts`: shown once the editor
is open (frame `ready`) and only for a user who may edit; the same installer,
platform-hint, download and launch wiring. The frame has no save coordinator,
so a small adapter (`frame-desktop-open.tsx`) feeds the action the frame's
dirty state and save, and the version a frame save committed is read back as
the document's current version. The launch target (GO-A6) and installer URLs
(GO-A8) come later. Evidence: `reports/uni-1014-evidence/desktop-open/`
(header button, installer menu, install prompt; vi + en, light + dark).

## AI in the frame (CONTRACT C16, ADR 0029 D9)

The frame calls GO-A7's AI routes itself, same origin, with
`Authorization: Bearer <frame token>` and `credentials: 'omit'`; there is no
postMessage relay. The routes are GO-A7's handlers (`handler.NewAIMountable`)
mounted on the frame token (`server/internal/handler/router/office_frame_ai.go`):

| route under `/api/v1/office-frame/documents/{documentID}/ai` | session twin under `/api/v1/orgs/{orgID}/ai` |
| --- | --- |
| `GET /credentials`, `PUT` / `DELETE /credentials/{aiProvider}` | `.../credentials...` |
| `POST /byok/{aiProvider}/chat/completions` \| `/messages` \| `/generate`, `GET /byok/{aiProvider}/models` | `.../byok/...` |
| `GET /cloud`, `POST /cloud/search` \| `/images` \| `/media/analyze` \| `/transcribe` | `.../cloud...` |

What each request passes, in order:

1. Frame auth (`officeFrameAuth`, the same as every frame route): a frame token
   only (a session token or a cookie is not one: 401), the token's document must
   be `{documentID}` (another document's or another organization's token: 404),
   and the token module's `office_*_web` flag must be on for the token's
   organization (off: 404 `feature_disabled`, as on every frame route).
2. The per-person rate limit: the same buckets and numbers as the session
   routes (`ai-credentials` 30/min, `ai-byok` 60/min, `ai-cloud` 20/min for the
   four tools; `GET .../cloud` only the global limit), keyed by the token's
   user, so a frame and a host tab of one person share one budget and a new
   document or provider does not reset it.
3. `frameAIActor` (`server/internal/handler/office_frame_ai.go`): rechecks on
   every request that the token's user may still view the token's document
   (`OfficeFrameService.Authorize`: ACL, same workspace, same organization,
   same module); a user who lost access gets 404 on the next call although the
   token has not expired. It then names the token's user and organization to
   GO-A7's handlers.
4. GO-A7's services as on the session routes: organization membership,
   `office.ai_byok` (credential `PUT` and the proxy; `GET`/`DELETE` stay open)
   or `office.ai_cloud` (the tools), credits (`ai.tokens`), usage rows, audit
   (`ai.credential.saved` / `.deleted`), error codes (402 `credits_exhausted`,
   403 `entitlement_required`, 404 `credential_missing`, 424
   `provider_auth_failed`, 429, 502, 503 `cloud_unavailable`). The BYOK stream
   is passed through byte for byte (SSE stays SSE).

Credentials are the person's own rows of (organization, user), not part of the
document, so **view access is the bar for every route, credential `PUT` /
`DELETE` included**: a key saved in a frame is the same key the session routes
list, in the document's organization.

**Host grant.** The frame-token answer (`POST /documents/{documentID}/office/frame-token`)
carries `ai: {ai, web_search, image_search, image_generation}`, read once at
mint (`officeFrameAIGrant`): `ai` when the person could use the proxy in the
document's organization (member, `office.ai_byok`, credential store
configured: `AIBYOKService.Enabled`), each cloud key only with `ai` and while
GO-A7's cloud status reports that tool (`office.ai_cloud` + a configured
provider). Anything that fails reads as off. The host
(`officeModuleCapabilities`) grants `ai`, `webSearch`, `imageSearch`,
`imageGeneration` only to a module with AI panels (`officeModuleSpec(m).ai`:
docs, pdf, markdown, html, slides; not sheets) and only as far as that grant;
a view-only user keeps AI (it still cannot save). Without the grant the frame
hides every AI entry, as before. The capability keys are re-vendored from the
fork (worker AI1, c044fa9) into `packages/core/office/docs-frame-protocol.ts`.

Tests: `server/internal/handler/office_frame_ai_test.go` (every route through
the frame token, refusals, per-request ACL, entitlement, flag, SSE pass-through,
the grant), `server/internal/handler/router/office_frame_ai_test.go` (binding,
shared budgets), `TestIsolationMatrix` rows, `TestAIBYOKServiceEnabled`,
`packages/views/office/frame/office-module-frame.test.tsx` and
`packages/core/api/endpoints/office-frame.test.ts` (grant).

## Sheets size cap (GO-D3 = C)

The Sheets frame runs the engine in WASM in the browser, so a workbook over
the cap opens in the G3 xlsx host. One number per module (`maxBytes` in
`office-modules.ts`, `maxBytes` in the server's `officeFrameModules`; xlsx
only, 10 MiB = 10 * 1024 * 1024 bytes of stored file, raise both together;
raised from 5 MiB on measurement: with the SH2 incremental index 2.2M dense
cells = a ~10.3 MB file, ~2.3 s to first paint, ~0.8 GB renderer peak, see the
fork's `docs/web-modules/sheets-sidecar.md`):

- Host gate: `ModuleFrameOrG3Host` compares the document's
  `file.size_bytes` and mounts the G3 host without asking for a token.
- Server gate: the mint answers 413 `too_large` for a stored file over the
  cap (after the ACL check), so a crafted client cannot open it in the frame.
  The module's flag answers first: with it off the mint is 403
  `feature_disabled` whatever the size.
- Frame gate: when the Sheets frame fails its open with `too_large` (sum of
  worksheet XML over 40 MB, checked in the frame) - or the mint answered 413 -
  `OfficeModuleFrame` hands the document to the G3 host through the same
  refusal path as `feature_disabled`. A module without a cap shows the error.

## Module e2e

`e2e/office-module-web-fixtures.ts` holds the module helpers (pin, installed
check, host wrapper locator, sign-in, stored bytes); `seedDocument` in
`office-docs-web-fixtures.ts` seeds a file of any format. A module spec runs
with `OFFICE_MODULES_WEB_E2E=1` and skips itself unless the web build under
test installed that module's pinned bundle:

```bash
# fork lane: npm run build:web -- --module markdown   (or build:web:all)
node apps/web/scripts/office-frame-sync.mjs --module markdown --pin --from <fork>/dist-web   # local pin
pnpm --filter @uniwork/web build && <start server + next start>
OFFICE_MODULES_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT \
  pnpm --filter @uniwork/e2e exec playwright test office-markdown-web.spec.ts
```

`office-markdown-web.spec.ts` is the first: serving headers, open + handshake
(`data-state="ready"` on the host wrapper), flag off -> G3; the edit -> save
-> reopen case is `test.fixme` until the fork's markdown module saves. CI
runs in the `e2e` job (`OFFICE_MODULES_WEB_E2E=1`, next to `OFFICE_DOCS_WEB_E2E`).
Like the Docs spec, its cases choose themselves from the installed manifests: a
module pin plus an `OFFICE_FRAME_SOURCE` holding that module's build runs the
frame cases; without a bundle (no pin committed yet, or no secret access) only
the "bundle not installed -> G3" case runs and the frame cases skip. A module
spec copies that shape, so adding one needs no CI change.

## Not done here

Module bundles, pins and module-specific capability keys belong to the module
workers. The Sheets sidecar question (GO-D3) keeps sidecar-only operations
hidden through capability keys.
