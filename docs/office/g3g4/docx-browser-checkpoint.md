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
The G2 operation reconciler remains the save-plan boundary.

## Verification on Node 22.23.2

- The 35 DOCX regression cases pass with the vendored schema.
- Views typecheck passes.
- Browser build, its input/external-import/locale test, vendor provenance and
  the existing Office boundary check pass.
- Artifact: 1,030,468 bytes; gzip 341,702 bytes before web mounting. This is
  the renderer artifact size, not a web chunk delta or a fidelity measurement.

## Acceptance still outstanding

This checkpoint does not establish full AC-2 through AC-6. Remaining work is
complete page styling/layout and headers/footers, read-only equation interaction,
save snapshot isolation and coordinator/upload/commit round trips, lazy web
mount and measured chunk delta, G3-D3 comparison artifacts, remaining gates,
FE and BE/security reviews, visual testing and independent final-SHA testing.

The old Orca dispatch returned consumer_fenced after the model resume. No final
worker_done is authorized on those stale IDs; the Advisor must rebind lifecycle
authority before final settlement. Code work continues under the direct user
instruction.
