# Office web modules: PDF, Markdown, HTML, Slides, Sheets in the web frame (UNI-1014/1015/1016)

The Docs web frame (`docs/office/docs-web-frame.md`, UNI-1013) is generalised to
every genoffice module. There is one protocol, one frame host, one set of
`/api/v1/office-frame/*` routes and one sync script; each of them takes a
module. Docs keeps every name, URL, pin and test it had.

| module | format | flag (default off) | issue |
| --- | --- | --- | --- |
| `docs` | docx | `office_docs_web` | UNI-1013 |
| `pdf` | pdf | `office_pdf_web` | UNI-1014 |
| `markdown` | md | `office_markdown_web` | UNI-1014 |
| `html` | html | `office_html_web` | UNI-1014 |
| `slides` | pptx | `office_slides_web` | UNI-1015 |
| `sheets` | xlsx | `office_sheets_web` | UNI-1016 |

xls, odt and every other format have no web module and keep the G3 host (or
its unsupported state).

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
  PDF flag and the other way round.
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
- `document-office-host.tsx` routes pdf/md/html/pptx/xlsx through
  `ModuleFrameOrG3Host` only when `pinnedFrameVersion(module)` is set; without
  an installed bundle the existing G3 host renders exactly as before.

## Sheets size cap (GO-D3 = C)

The Sheets frame runs the engine in WASM in the browser, so a workbook over
the cap opens in the G3 xlsx host. One number per module (`maxBytes` in
`office-modules.ts`, `maxBytes` in the server's `officeFrameModules`; xlsx
only, 5 MiB = 5 * 1024 * 1024 bytes of stored file, raise both together):

- Host gate: `ModuleFrameOrG3Host` compares the document's
  `file.size_bytes` and mounts the G3 host without asking for a token.
- Server gate: the mint answers 413 `too_large` for a stored file over the
  cap (after the ACL check), so a crafted client cannot open it in the frame.
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
does not set `OFFICE_MODULES_WEB_E2E` yet (no module pin is committed).

## Not done here

Module bundles, pins and module-specific capability keys belong to the module
workers. The Sheets sidecar question (GO-D3) keeps sidecar-only operations
hidden through capability keys.
