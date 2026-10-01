# UNI-823 browser renderer checkpoint

The renderer now builds through `node scripts/office/build-upstream.mjs
--docx-browser`. Package consumers use the generated browser ESM artifact and
the typed entry, with no Vite or Next aliases and no direct export of vendor
source. `pnpm install` generates the artifact through the package prepare hook.

Build-time aliases bind GenOffice imports to the existing vendored engine
packages. The locale import binds to the i18next adapter and 33 vi/en keys under
`office.docx.editor`. TipTap and i18next remain shared external dependencies.
The browser build rejects any other unresolved external import.

The real WordArt and shape geometry helpers replace the empty UI shim. These
two source files and the missing pagination-measure/pagination-slices closure
are selected through vendor-upstream from the pinned git object store. The
manifest already allowlists packages/ui and apps/docs. No upstream file is
hand-edited, and no Node/Electron dependency required a stub.

The hand-authored docxBlock node and duplicate StarterKit/history are removed.
The surface now uses the vendored extensions, blocksToPmDoc and inline run
conversion; heading/list commands target docHeading/docListItem/docParagraph.
The save bridge translates the vendored save plan to G2 operations in an
isolated session. Capturing a local draft does not mutate the live G2 model.

## Verification on Node 22.23.2

- All 40 DOCX cases pass with the vendored schema, including the original 35.
- Views typecheck passes.
- Browser build, its input/external-import/locale test, vendor provenance and
  the existing Office boundary check pass.
- Artifact: 1,030,468 bytes; gzip 341,702 bytes before web mounting. This is
  the renderer artifact size, not a web chunk delta or a fidelity measurement.

## Real OOXML round trip

`docx-roundtrip.test.ts` builds an OOXML ZIP and uses the vendored engine,
TipTap handle, G2 adapter and G3 save coordinator. Both coordinator entry points
(`button` and `shortcut`) serialize, upload and commit through in-memory cloud
ports. Reopening the uploaded bytes confirms Heading 1 changed to Heading 2.
The header, styles, referenced PNG and custom XML retain identical part bytes;
the untouched paragraph retains its text. This caught and fixed a stale
Heading1 style ID overriding the newly selected heading level during save.

This is an integration harness, not a browser click/keyboard or server test.
Evidence is in the lane report logs `ooxml-roundtrip-r4.log` (40/40),
`ooxml-typecheck-r1.log` and `ooxml-lint-r2.log` under Node 22.23.2.

## Web integration checkpoint

The documents route now selects a lazy DOCX host for DOCX files. The host
negotiates open/edit/serialize capabilities for the current document before
loading the browser adapter. It binds the vendored engine and shared TipTap
view to the protected browser draft session and the existing Documents
upload/version-commit endpoints. Upload and commit receipts must match the
document, checksum and size; revision strings and idempotency keys are retained.

Editor transactions publish dirty generations immediately. The host owns
session disposal, so React Strict Mode effect replay leaves the active editor
alive. Late responses from a replaced document are ignored; presentation-only
title changes retain the editing session. G2 open warnings pass through intact.

Focused evidence on Node 22.23.2: DOCX views 43/43, web host/transport plus
XLSX/host regressions 25/25, web/views typecheck and focused lint. Logs:
`web-docx-views-r2.log`, `web-docx-host-tests-r2.log`,
`web-docx-typecheck-r3.log`, `web-docx-views-typecheck-r1.log`,
`web-docx-host-lint-r4.log`, `web-docx-lint-r2.log`,
`web-docx-views-lint-r1.log`.

This checkpoint does not prove the real browser/server save interaction,
page fidelity, read-only content viewing, web build or gzip delta. Those remain
part of the acceptance work below.

## Acceptance still outstanding

This checkpoint does not establish full AC-2 through AC-6. Remaining work is
complete page styling/layout and headers/footers, read-only equation interaction,
web UI save/upload/commit round trips, lazy web
mount and measured chunk delta, G3-D3 comparison artifacts, remaining gates,
FE and BE/security reviews, visual testing and independent final-SHA testing.

The Advisor reattached the lead with task `task_d909342abdee` and dispatch
`ctx_940d2c69abe1`; final settlement must use that active dispatch.
