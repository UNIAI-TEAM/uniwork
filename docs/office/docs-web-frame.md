# Docs web frame: serving the genoffice Docs bundle (UNI-1013)

The web opens a DOCX in the genoffice Docs renderer running in a same-origin
iframe (`/office-frame/docs/<version>/index.html`), behind the
`office_docs_web` flag. The G3 editor stays the default until acceptance.
This page is the serving half: where the bundle comes from, how it is pinned
and verified, and which headers it gets. The postMessage protocol and the host
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
without access to the fork still builds (the flag is off by default and the
frame simply 404s). A deployment that wants the frame must set
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
`platform/office-frame/docs-frame-api.ts` is the `DocsFrameApi` the frame's
`api.*` requests go through: open/save/recents/image upload on the
`/api/v1/office-frame/*` routes with the document-scoped frame token; save-as,
export and attachments answer a typed `unsupported` until a server endpoint
exists.

## Moving the frame to its own origin later

Serve the same directory from the subdomain, send the same headers with
`frame-ancestors` set to the app origin (rebuild the fork with
`WEB_DOCS_CSP_FRAME_ANCESTORS`), and point the host at the new URL; the
protocol carries a token, not cookies. `enforceFrameAncestors` in
`frame-bundle.mjs` deliberately pins `'self'` today, so that change is a
reviewed edit, not a side effect of a bundle.
