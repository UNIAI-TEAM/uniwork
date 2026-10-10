# Docs web frame: serving the genoffice Docs bundle (UNI-1013)

The web opens a DOCX in the genoffice Docs renderer running in a same-origin
iframe (`/office-frame/docs/<version>/index.html`), behind the
`office_docs_web` flag, on by default since 2026-10-09 (user decision,
lane CONTRACT C14; an organization or user override turns it off). The G3
editor opens whenever the flag is off or the bundle is not installed.
This page is the serving half: where the bundle comes from, how it is pinned
and verified, and which headers it gets. The other genoffice modules (pdf,
markdown, html, slides, sheets; UNI-1014/1015/1016) reuse every piece below
with a module parameter: `docs/office/office-web-modules.md`. The postMessage protocol and the host
component live in `packages/views/office` and `packages/core/office`.

## Where the bundle lives, and why it is not checked in

The fork (`uniwork-office`, `npm run build:web`) emits
`dist-web/docs/<package version>-<git sha>/` with `manifest.json`
(`version`, `gitSha`, `entry`, `files[{path,bytes,sha256}]`, `dirty`) and
`csp.json`. That is ~18 MiB, regenerated on every fork build, so it is
**not** committed: the precedent in this repo is the git-ignored pdfium wasm
copied by `apps/web/scripts/copy-pdfium-wasm.mjs`. What is committed is
`apps/web/platform/office-frame/docs.pin.json`:

| field | meaning |
| --- | --- |
| `version`, `gitSha`, `entry` | the build that is served, and the fork commit it came from |
| `manifestSha256` | sha256 of that build's `manifest.json`; the manifest digests every file, so this one value pins the whole bundle |
| `headers` | the response headers the frame needs (the Content-Security-Policy from `csp.json`), so a policy change shows in review next to the version bump |

## Commands (`apps/web`)

```bash
# install the pinned build from a fork checkout, a tarball or an https URL
OFFICE_FRAME_SOURCE=/path/to/uniwork-office/dist-web/docs pnpm --filter @uniwork/web office-frame:sync
# move the pin to another build (review the diff of docs.pin.json!)
node apps/web/scripts/office-frame-sync.mjs --from <source> --pin
pnpm --filter @uniwork/web office-frame:check     # re-verify what is installed against the pin
```

`sync` refuses a build whose manifest digest, version, git SHA or entry differ
from the pin, any file whose size or sha256 differs from the manifest, a
manifest path that escapes the bundle, a `csp.json` that differs from the
pinned headers, and a build made from a dirty fork checkout (`--allow-dirty`
is for local runs; never commit that pin). It installs into
`apps/web/public/office-frame/docs/<version>/` via a staging directory and
removes older versions.

`pnpm build` and `pnpm dev` run `office-frame-sync.mjs --ensure`: already
installed and verified is a no-op; otherwise it syncs from
`OFFICE_FRAME_SOURCE`; with no source it warns and carries on, so a checkout
without access to the fork still builds. `next.config.mjs` offers the frame
(`NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION`) only when the pinned bundle is
installed and verifies against the pin, so without a bundle every organization
keeps the G3 editor even with `office_docs_web` on (no 404 iframe).

An archive source (`.tar.gz`, or an https URL to one) is listed before it is
extracted: only regular files and directories, no absolute or `..` names, at
most 2000 entries, 160 MiB unpacked, 64 MiB archive, and a 120 s deadline for
the download and the tar calls. Its manifest and every file digest are then
checked before anything is copied into `public/`. A deployment that wants the frame must set
`OFFICE_FRAME_SOURCE` at image build time (the web Dockerfile runs
`pnpm build`).

## Headers (`apps/web/next.config.mjs` -> `platform/office-frame/frame-headers.mjs`)

For every path under `/office-frame/`: the pinned `Content-Security-Policy`
(always with `frame-ancestors 'self'`; a `csp.json` naming anything else is
refused), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`. Caching: files below a directory of a version
(`assets/**`, `fonts/**`, content-hashed) are
`public, max-age=31536000, immutable`; a version's top-level files
(`index.html`, `manifest.json`, `csp.json`) are `public, max-age=0,
must-revalidate`. With no pin the paths get `default-src 'none'; frame-ancestors
'self'`. `office-frame` is a reserved slug (an organization named that would
otherwise inherit these headers).

## Flag wiring and host

`next.config.mjs` inlines the pinned version as
`NEXT_PUBLIC_OFFICE_DOCS_FRAME_VERSION` (empty without a pin).
`platform/office/document-office-host.tsx` routes a docx through
`platform/office-frame/docs-frame-host.tsx`: with no pinned version it is the
G3 host alone; otherwise `DocxOpenSwitch` (`packages/views/office/frame`)
reads `office_docs_web` for the document's organization
(`useOfficeDocsWebEnabled`, the organization-scoped `GET /api/v1/config`) and
mounts `OfficeDocsFrame` only on a settled "on", the G3 host on anything else.
`docs-frame-host.tsx` mounts `OfficeDocsFrame` with the core defaults: the
token comes from `useOfficeFrameToken` and the frame's `api.*` requests go
through `createDocsFrameApi` (`packages/core/office/docs-frame-api.ts`, over
the `/api/v1/office-frame/*` routes with the document-scoped frame token).
The host only adds `onSavedAs`, which navigates the page to the copy.

- **Open / save / recents:** open hands the frame the bytes; save is upload +
  commit against the document revision (a stale base is a typed `conflict`,
  which the frame answers with its own Cancel / Reload / Overwrite dialog; the
  host does not toast it). A save without the etag the frame opened with is
  refused (`malformed`), never rebased onto the newest revision. Save, save-as
  and export each send one Idempotency-Key derived from what the operation is
  (kind, document or workspace, base revision, sha256 of the bytes), so a retry
  after a lost answer replays the first attempt instead of colliding with it.
- **Flag turned off under a cached page:** if the server refuses the token mint
  with `feature_disabled` (the page's config answer is cached up to 5 minutes),
  `OfficeDocsFrame` tells `DocxOpenSwitch` and the G3 editor takes over; a
  standalone frame shows "not turned on for your organization".
- **Save as:** the session creates the copy (`createDocumentFile`), mints a
  token for it and rebinds the frame to it; the page then follows the copy.
- **PDF export:** `POST /api/v1/office-frame/documents/{id}/export/pdf`. A 200
  is the PDF; 501 `unsupported_operation` or 503 `office_not_configured` (no
  engine or renderer on this deployment) answers a typed `unsupported`, and
  the frame prints in place instead. `UNIWORK_DOCS_PDF_ASSETS` (the pinned
  bundle + Chromium) and `OFFICE_ENGINE_MEMORY_MB >= 1024` turn the real
  renderer on (`docs/ops/RUNBOOK_OFFICE_ENGINE.md`).
- **Images:** the frame embeds images as `data:` URIs in the docx and never
  calls `api.images.upload`; `img-src 'self' data: blob:` covers it. The host
  has no image-upload handler (a request answers `unsupported`): a signed
  asset URL on the API origin could not load under that `img-src` anyway.
- **Save as:** the page follows the copy and mounts a fresh frame for the new
  document id (the document screen swaps its host while the copy loads), so the
  copy opens clean from its stored version. The in-place rebind of a live frame
  is unit-tested in `packages/views`.
- **Still `unsupported`:** attachments, HTML export, `file.pick` (the host
  does not grant the `filePick` capability).

The protocol files in `packages/core/office/docs-frame-{protocol,endpoint,host}.ts`
are vendored byte-identical (import specifiers aside) from the fork at
the SHA in their header (now the GO-B4/B5/B6 framework commit `3ce2107`,
whose only protocol change is the additive `module` field). The pinned Docs
bundle (`docs.pin.json`, fork `5a81008`) predates that field: its `ready`
carries no module, which reads as docs.

## CI

`e2e/office-docs-web.spec.ts` runs in the `e2e` job (`OFFICE_DOCS_WEB_E2E=1`).
With the `OFFICE_FRAME_SOURCE` secret (an https `.tar.gz` of the fork build the
pin names) the frame cases run; without it the bundle is not installed and the
spec runs its "not installed -> G3" case instead. The cases choose themselves
from `GET <frame>/manifest.json`, so one job covers both. It needs no office
engine (the PDF step accepts the 503/501 print fallback) and drives the frame
by its Vietnamese labels.

## Security note

The same-origin iframe has no `sandbox` (it cannot usefully have one with
`allow-same-origin`): until the frame moves to its own origin, a compromise of
the bundle is a compromise of the user's UniWork session. The document-scoped
token only limits what a separate origin could do.

## Moving the frame to its own origin later

Serve the same directory from the subdomain, send the same headers with
`frame-ancestors` set to the app origin (rebuild the fork with
`WEB_DOCS_CSP_FRAME_ANCESTORS`), and point the host at the new URL; the
protocol carries a token, not cookies. `enforceFrameAncestors` in
`frame-bundle.mjs` deliberately pins `'self'` today, so that change is a
reviewed edit, not a side effect of a bundle.
