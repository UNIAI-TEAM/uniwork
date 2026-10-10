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
  (all six are checked in, see "Pinned builds" below). The manifest may name its `module`; absent is docs, and a
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

## When the frame never boots (visual S-03, FV1; slow-frame FL)

A bundle that answers 404/5xx on `index.html` loads a dead page into the
iframe, and an iframe fires no error event for that, so without a guard the host
would sit on the loading skeleton forever (every module, Docs included).
`useDocsFrameSession` therefore guards each attempt three ways:

- It probes the frame document once (`frameSrc`; an HTTP status >= 400 fails at
  once).
- Once the iframe fires `load` without the handshake having completed, it probes
  every `script[src]` of the frame document (`cache: "force-cache"`, so a script
  that did load is answered from the HTTP cache). A script that answers >= 400,
  or cannot be fetched at all, fails the boot at once (`frameBundle: "script"`):
  a module script that fails to load does not reach the page as an error, and the
  frame document still loads, so this is the early signal. A frame document the
  page cannot inspect, and a probe that merely cannot run, leave the verdict to
  the timer.
- A 25 s handshake timer (`BOOT_TIMEOUT_MS`, was 60 s) covers a bundle that loads
  but never says `ready`. A hung frame is far more common than one that needs
  longer, and a minute of bare skeleton reads as a dead page; 25 s still leaves
  room for a cold start on a slow link.

Any of them ends the boot with a failure tagged `details.frameBundle`
(`missing` | `script` | `timeout`). Between 8 s (`SLOW_AFTER_MS`) and the verdict the
skeleton gives way to a "taking longer than usual" state (`slow`, spinner and one
line): "Use the standard editor" switches to the G3 host now where the page has
one, "Try again" (a fresh attempt, the clock restarts) where it has not.

`OfficeModuleFrame` hands a failure to the open switch like `feature_disabled`
and `too_large`, so the G3 editor takes over (`useDocsFrameRefusal`). The
refusal carries a reason: a frame that did not load passes `"load"`, and
`OfficeModuleOpenSwitch` then shows a short inline notice above the G3 host
("The new editor could not load; you are using the standard editor", Sheets
S-07) so the switch is explained; a flag, a size cap or the reader's own click
on "Use the standard editor" switch without one. Where no G3
host is wired, `DocsFrameFailure` shows the styled "the editor could not load"
panel with Try again (plus "Use the standard editor" when one is offered).
Tests: `apps/web/platform/office-frame/module-frame-boot-fallback.test.tsx`,
`packages/views/office/frame/office-module-frame.test.tsx` (fake timers: the 8 s
slow state, the 25 s fallback, the script probe, the notice); e2e
`e2e/office-modules-web.spec.ts` (a missing module bundle, and a blocked frame
script, fall back to the G3 host with the notice).

## Keyboard focus around the frame (visual F-12)

Focus inside the iframe is invisible to the page, so the host puts it back where
the user was:

- The leave dialog (Save / Discard / Stay) passes `finalFocus` to its Base UI
  popup; closing it by Stay, Escape or the close button focuses the iframe and its
  window instead of the page element that held focus before. The frame document
  keeps its own active element, so the editor receives it and Ctrl+S works
  without a click. A leave that navigates away skips it (the frame is unmounting).
- The "Open in desktop app" split menu returns focus to its chevron trigger on
  Escape (Base UI's default, now pinned by `desktop-open-action.test.tsx`).

Tests: `packages/views/office/frame/office-docs-frame.test.tsx`.

## Draft recovery (CONTRACT C18, C18a)

Every genoffice frame keeps an encrypted copy of the document being edited in
its own IndexedDB (database `uniwork-office-frame-drafts`, store `drafts`) and
offers it back after a crash, a closed tab or a reload. The copy is useful only
because the frame can decrypt it again, so the key must outlive the page.

- The host (`packages/core/office/draft-session-key.ts`) owns one AES-GCM 256
  key per user, generated non-extractable. It is persisted as a structured-clone
  `CryptoKey` in the same database, store `keys`, record key = userId; the bytes
  are never exported, so they are in neither storage nor the server. The first
  need creates it; a reload and a second tab of that user read the same record
  (the get-or-put is one readwrite transaction, so two tabs racing on first use
  agree). Every frame gets the key in `init`, again after a frame reload.
- The host creates both stores (`drafts`, `keys`) at database version 1, the
  version the frame opens, because the frame only creates `drafts` on an upgrade.
- Sign-out and a user switch call `endOfficeDraftSession()`, which deletes the
  whole database: the drafts and the keys together. A new sign-in gets a new
  key, so nothing written earlier can be read. It never touches the G3 web
  host's `uniwork-office-drafts`, whose drafts outlive sign-out on purpose. A
  key load waits behind a delete already issued, so a user switch cannot wipe
  the new user's key.
- Where IndexedDB is unavailable (private mode, a refusing browser) the key
  lives in the host's memory: recovery then survives a frame reload, not a page
  reload. Nothing else degrades.
- User-facing wording: recovers after a crash, a closed tab or a reload, until
  you sign out.

Tests: `packages/core/office/draft-session-key.test.ts` (fake-indexeddb: the key
persists across a simulated reload and between racing tabs, non-extractable,
deleted on sign-out, different per user, the G3 database untouched, memory
fallback) and `packages/core/auth/store.test.ts` (logout ends the session).

## Open in desktop app (GD3)

Every module frame, Docs included, carries the G3 editor's "Open in desktop
app" split button (`DesktopOpenAction`: launch session + `uniwork://` deep
link + installer menu) in the page header's action cluster. One rule for both
hosts, `apps/web/platform/office/desktop-open-props.ts`: shown once the editor
is open (frame `ready`) and only for a user who may edit; the same installer,
platform-hint, download and launch wiring. The frame has no save coordinator,
so a small adapter (`frame-desktop-open.tsx`) feeds the action the frame's
dirty state and save, and the version a frame save committed is read back as
the document's current version. The launch target and installer links are
already in this branch: `POST /documents/{id}/office/sessions` (GO-A6 launch
ticket) -> `uniwork-office[-dev]://open?ticket=` (parsed by
`apps/office-desktop/main/deep-links/parser.ts`), and `GET
/office/desktop/download` fed by `OFFICE_INSTALLER_{DEV,BETA,STABLE}_URLS`
(GO-A8). Without those env values the install prompt says the channel has no
installer yet; that is deployment config, not code. Evidence:
`reports/uni-1014-evidence/desktop-open/` (header button, installer menu,
install prompt; vi + en, light + dark).

### Frame request `app.open` (A7 contract, additive)

A frame that cannot do something on the web (PDF OCR, Markdown Source mode,
...) shows "Open in the UniWork Office app to use this feature" plus an action.
That action calls ONE host request; the frame never builds a deep link.

- Capability `desktopOpen` (boolean, host-granted): the host grants it only
  when its own "Open in desktop app" action is available (editor open, user
  may edit, deployment id known). Without it the frame shows the message only.
- Frame -> host request `app.open`, payload `{ feature?: string }` (a short
  opaque tag such as `pdf.ocr`, for the host's own dev diagnostics only; never
  shown, never sent to a server), result `{ outcome: "launched" | "installer" |
  "unavailable" }`.
- The host runs exactly the header button's flow (`DesktopOpenAction`): the
  dirty dialog when the frame has unsaved edits, then the launch session and
  the deep link, then the installer prompt when the app did not answer.
  `launched` = the browser tab hid after the deep link; `installer` = the
  install prompt was opened; `unavailable` = no deployment id / no committed
  version / the action is busy (the host also shows its own `role="alert"`).
- Additive: an old host does not know `app.open` (the frame sees `unsupported`
  and keeps the message only); an old frame never sends it.

## Host chrome around the frames (UNI-1232 polish)

What the UniWork page owns around every module frame, one behaviour for all six:

- **Header on a phone.** A file's breadcrumb crumbs hide below `sm` (the back
  control stands in), so the title truncates with the full name as a tooltip
  instead of collapsing to a letter. The frame's header cluster is status +
  a **Save** button (`data-office-frame-save`): an icon with an accessible
  name "Save to UniWork" on a phone, labelled from `sm`, quiet (outline,
  `aria-disabled`, still in the tab order) while nothing is unsaved. The
  desktop actions fold into the page's overflow menu below `sm`.
- **View-only is announced once.** For a file the banner under the header
  (title + reason, one live region) is the announcement; the header chip is
  gone (a page keeps the chip only where its banner is hidden). The frames hide
  their own chip through the `viewOnlyChip` capability.
- **Preference toasts name the preference** ("Language preference saved"), so
  a language or theme switch never reads as the document's save state.
- **Failure panel.** A denied reader (403/404) gets the reason and a link back
  to the workspace document list, never "Try again"; retry stays for network,
  load and generic failures.
- **Failed save.** The header keeps "Save could not be confirmed" until the
  frame reports dirty again (the next edit), then says "Unsaved".
- **Standard-editor notice.** A workbook over the Sheets cap (host gate or the
  frame answering `too_large`) opens in the G3 editor under one sentence:
  "This file is too large for the web editor, so it opened in the standard
  editor". The frame-load fallback keeps its own sentence (`reason` = `size` |
  `load`, `data-testid="office-frame-fallback-notice"`).
- **Leave dialog = the reference look**: filled primary, close X named Close,
  blurred scrim, focus trap, and on close the host focuses the iframe and its
  window (the same signal for every module; the frames' focus-return bridge
  listens for it).

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
all six modules) and only as far as that grant;
a view-only user keeps AI (it still cannot save). Without the grant the frame
hides every AI entry, as before. The capability keys are re-vendored from the
fork (worker AI1, c044fa9) into `packages/core/office/docs-frame-protocol.ts`.

The three vendored protocol files (`docs-frame-{protocol,endpoint,host}.ts`) are
the fork lane head `98e1d20` (branch `feature/UNI-1014-web-modules`), which holds
DR1 draft recovery (`InitPayload.recovery`), the `modal` event, SP1, H2, the
AI1 capability keys and the SH4 Sheets AI in one lineage, so nothing is merged by hand any more. They
are byte-identical to the fork's `web/docs/protocol/{types,endpoint,host}.ts`
except the relative import specifiers; the bodies did not change between the
earlier `f1679cb` + AI1 `c044fa9` vendoring, `11a5eba` and `36e9e23`, only the headers.
`36e9e23..9b5e409` changed `types.ts` in one comment (`InitRecovery.key` is persisted
per user, C18a); `9b5e409..98e1d20` changed nothing under `web/docs/protocol/` (the `08fafd4..98e1d20`
range only touched its README). No type,
message or version changed. The
bundles in "Pinned builds" are built from the same commit.

Tests: `server/internal/handler/office_frame_ai_test.go` (every route through
the frame token, refusals, per-request ACL, entitlement, flag, SSE pass-through,
the grant), `server/internal/handler/router/office_frame_ai_test.go` (binding,
shared budgets), `TestIsolationMatrix` rows, `TestAIBYOKServiceEnabled`,
`packages/views/office/frame/office-module-frame.test.tsx` and
`packages/core/api/endpoints/office-frame.test.ts` (grant).

### Sheets AI is on

`officeModuleSpec("sheets").ai` is `true` since the fork Sheets frame reads the
host grant (worker SH4): it maps the host's `ai`, `webSearch`, `imageSearch` and
`imageGeneration` to its renderer keys and installs the shared web AI bridge, so
the host treats Sheets like every other module: the same token grant, the same
frame-token AI routes, nothing per format on the server (`office.ai_byok` /
`office.ai_cloud` are organization entitlements). The four desktop-only members
of the desktop Sheets AI (`createDocument`, `readLocalImage`,
`openWorkbooksForMerge`, `autoRenameWorkbook`) stay hidden in the frame, and
`mergeWorkbooks` stays hidden by CONTRACT C11. The `["sheets", ...]` case lives in
the AI table of `office-module-frame.test.tsx`.

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
  uncompressed worksheet XML over 80 MiB = 80 * 1024 * 1024 bytes,
  `MAX_WORKSHEET_XML_BYTES` in the fork's `web/modules/sheets/engine/wasm-transport.ts`,
  checked in the frame; a separate, much larger number than the 10 MiB stored-file
  cap above) - or the mint answered 413 -
  `OfficeModuleFrame` hands the document to the G3 host through the same
  refusal path as `feature_disabled`. A module without a cap shows the error.

## Module e2e

`e2e/office-module-web-fixtures.ts` holds the module helpers (pin, installed
check, host wrapper locator, sign-in, stored bytes); `seedDocument` in
`office-docs-web-fixtures.ts` seeds a file of any format. A module spec runs
with `OFFICE_MODULES_WEB_E2E=1` and skips itself unless the web build under
test installed that module's pinned bundle:

```bash
# fork checkout at the pinned commit: npm run build:web:all && tar -C dist-web -czf dist-web.tar.gz .
OFFICE_FRAME_SOURCE=$PWD/dist-web.tar.gz pnpm --filter @uniwork/web build   # installs every pinned module
<start server + next start>
OFFICE_MODULES_WEB_E2E=1 E2E_BASE_URL=http://localhost:$FRONTEND_PORT \
  pnpm --filter @uniwork/e2e exec playwright test office-docs-web.spec.ts office-markdown-web.spec.ts office-modules-web.spec.ts
```

(A new pin for one module: `node apps/web/scripts/office-frame-sync.mjs --module <m> --pin --from <fork>/dist-web`.)

`office-markdown-web.spec.ts`: serving headers, open + handshake
(`data-state="ready"` on the host wrapper), the Desktop-open button in vi/en x
light/dark, edit -> save -> reopen (a new stored version holding the edit, and
the frame showing it after a reload), flag off -> G3.
`office-modules-web.spec.ts` is table-driven over the other four modules, one
stored document each (pdf `pdf-text-editable.pdf`, html page, pptx
`pptx-standard-business.pptx`, xlsx `xlsx-compatibility-basic.xlsx`): the
module's iframe is served from its pinned base, the handshake completes with
no CSP violation and no G3 host next to it; html (source pane) and sheets (A1
through the Name Box) additionally save one edit and the spec reads the new
version back from the server. pdf and slides are open-only here, their editing
round trips live in the fork's own e2e (annotate/ink, presenter).
CI runs them in the `e2e` job (`OFFICE_MODULES_WEB_E2E=1`, next to
`OFFICE_DOCS_WEB_E2E`).
Like the Docs spec, each case chooses itself from the installed manifests: a
module pin plus an `OFFICE_FRAME_SOURCE` holding that module's build runs the
frame cases; without the bundle (no secret access) only the markdown spec's
"bundle not installed -> G3" case runs and the frame cases skip. A new
module spec copies that shape, so adding one needs no CI change.

## Pinned builds

All six modules are pinned to one fork commit, the lane head `98e1d20`
(`0.1.0-98e1d20` = `08fafd4` + the FDX Docs and FSH Sheets fixes, the shared frame
dialog, the AI panel and failed-save wording fixes in PDF, Markdown and HTML
(DP5 re-pin); `08fafd4` was `9b5e409` + the GO-A6 merge (UniWork documents), the
`uniworkState` stub of every module's web API, the PDF close-save origin and the
Sheets view-only lock kept off the frame; `9b5e409` itself was `36e9e23` + SH4
Sheets AI, the FF1 hardening fixes and the per-platform wasm checksum; built clean:
no `-dirty` suffix, `npm run build:web -- --all` in a detached worktree of
`98e1d20`, not the fork lane's own checkout). The pins'
headers did not change from `36e9e23`, only version, SHA and manifest digest. Written by
`node apps/web/scripts/office-frame-sync.mjs --all --pin --from <tarball of dist-web>`
and verified file by file on install.

| module | pin | files | unpacked | gzip | initial download | CSP beyond the shared policy |
| --- | --- | --- | --- | --- | --- | --- |
| `docs` | `docs.pin.json` | 46 | 16.74 MiB | 11.69 MiB | 4.93 MiB | none |
| `pdf` | `pdf.pin.json` | 229 | 13.70 MiB | 7.02 MiB | 1.76 MiB | `script-src 'wasm-unsafe-eval'` (pdf.js decoders) |
| `markdown` | `markdown.pin.json` | 90 | 7.91 MiB | 2.55 MiB | 2.81 MiB | none |
| `html` | `html.pin.json` | 7 | 1.74 MiB | 0.57 MiB | 1.73 MiB | `frame-src 'self'` + `documents[/preview.html]` |
| `slides` | `slides.pin.json` | 19 | 5.48 MiB | 2.25 MiB | 4.15 MiB | `media-src blob:` |
| `sheets` | `sheets.pin.json` | 219 | 26.79 MiB | 7.64 MiB | 3.29 MiB | `script-src 'wasm-unsafe-eval'` (xlsx engine, GO-D3 = C) |

Policy review of the pin diffs (what a reviewer of a re-pin checks): every
module keeps `default-src 'none'`, `connect-src 'self'`, `base-uri 'self'`,
`form-action 'self'` and `frame-ancestors 'self'`; only `pdf` and `sheets` have
`'wasm-unsafe-eval'` and nobody has `'unsafe-eval'` in the frame policy.
`html` is the one with a `documents` entry: `/preview.html` carries its own
sandboxed policy (`sandbox allow-scripts allow-forms allow-popups allow-modals`,
no `allow-same-origin`, `connect-src 'none'`, `form-action 'none'`,
`frame-ancestors 'self'`). That policy lets the previewed page's own scripts
run (`script-src 'unsafe-inline' 'unsafe-eval' https:`, as the desktop preview
does, CONTRACT C15(1)); it is the policy of an opaque-origin document, never of
the frame, and the host refuses to pin or serve one that is not that kind.

**Archive limits.** `DEFAULT_ARCHIVE_LIMITS` in `frame-install.mjs` (64 MiB
archive, 160 MiB unpacked, 2000 entries) were sized for one Docs build. The
six builds in one `dist-web` root measure 31.8 MiB as a `.tar.gz`, 72.4 MiB
unpacked, 644 entries (`tar -C dist-web -czf dist-web.tar.gz .`), so the
limits hold with about 2x headroom and are unchanged; the whole tarball was
installed through `materialize` + `loadBundle` by the sync run above. Raise
them (with the reason) when a rebuild approaches them: `sheets` is the
biggest, 27 MiB of the 72 MiB.

**`OFFICE_FRAME_SOURCE` (CI secret and image builds).** It must now be a
tarball (or https URL to one) of the fork's whole `dist-web` root, holding
`<module>/<version>/` for every pinned module:

```bash
# in the fork checkout, at the commit the pins name
npm run build:web:all            # dist-web/{docs,pdf,markdown,html,slides,sheets}/0.1.0-<sha>/ (98e1d20: 31.8 MiB as a tarball)
tar -C dist-web -czf dist-web.tar.gz .
# publish dist-web.tar.gz where the secret's URL points; the sync verifies it against the pins
```

The Docs-only layout (a `dist-web/docs` tarball, as the secret held for
UNI-1013) still installs docs and warns that the other five are missing: with
that secret the `e2e` job runs the docs frame cases and the other modules'
cases skip (each module spec skips itself when its bundle is not installed),
so update the secret together with the pins. `next build` offers a module only
when its pinned bundle installs and verifies
(`NEXT_PUBLIC_OFFICE_FRAME_VERSIONS`); with all six installed it lists all six.

**The Sheets wasm differs per platform.** The xlsx engine's `xlsx-sidecar.wasm`
is byte-different on linux-arm64 and linux-x64 from the same inputs, so the fork
keeps one checksum line per platform
(`apps/sheets/native/xlsx-engine/wasm/xlsx-sidecar.wasm.sha256`) and
`manifestSha256` in `sheets.pin.json` covers the wasm bytes. The pin is therefore
the **linux-arm64 build made on bro** (wasm sha256 `e56985bc...27cd`, arm64
line of the fork file). A tarball built on an x64 machine (the CI secret, if it is
built there) holds a different Sheets wasm, so `office-frame-sync` refuses it
against this pin: publish the secret from the bro tarball
(`dist-web-0.1.0-98e1d20.tar.gz`), or re-pin from an x64 build and let CI use that
one; never mix the two.

Open: the `e2e` job's secret to be re-published by whoever holds it from the
tarball above (the fork CI does not publish a `dist-web` tarball).

## Not done here

Module-specific capability keys belong to the module workers. The Sheets
sidecar question (GO-D3) keeps sidecar-only operations hidden through
capability keys.
