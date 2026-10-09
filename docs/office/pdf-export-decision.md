# Server-side PDF export for the Docs web frame — decision note

> **Status:** prototype landed behind `office_docs_web` (UNI-1013, lane GO-B2+B3, W8). 2026-10-08.

## Question

On the web, the genoffice Docs editor runs in an iframe and has no Electron
`webContents.printToPDF`. The spike (UNI-1011 REPORT §7) named "server-side PDF
export fidelity" its biggest risk. Which renderer should produce the PDF so it
matches what the desktop app exports: **(a)** something inside the existing
office-engine container, or **(b)** headless Chromium running the same Docs web
renderer and calling `page.pdf()`?

`apps/office-engine` today runs **no** office suite: it is Node plus pdfium/harfbuzz
wasm (PDF editing), the xlsx gateway and its Rust sidecar, and the Q7 converters.
Option (a) therefore means adding LibreOffice to it. That is the arm measured as (a).

## Re-verified on the pinned bundle (fork 5a81008)

The numbers below this section were measured on the spike build (4a70857), whose
renderer opened the input from `?open=`. The web bundle the product pins no longer has that
path (documents open through the postMessage host), so the engine now loads the pinned build
through the renderer's **headless entry**, `index.html?headless=1&open=/__input.docx`
(fork 5a81008): top-level only, no handshake, light theme, print / `exportPdf` only. The
renderer's own headless path (`consumeHeadlessExport` -> `exportPdf` / `printPdfBuffer`
-> `headlessExportDone`) is unchanged, so the page shim works as before.

`docs-pdf.test.ts`'s real-renderer cases ran against `apps/web/public/office-frame/docs/0.1.0-5a81008`
(the bundle `docs.pin.json` pins) in Playwright's chromium headless-shell 1234, with the engine's
own CDP driver (loopback server with the bundle's CSP, Fetch interception, `--no-sandbox` as the
uid-sandboxed job runs it):

| Fixture | Pages (desktop) | Pages (pinned bundle, engine) | Render wall |
|---|---|---|---|
| simple | 1 | **1** | 1.6 s |
| kitchen-sink | 1 | **1** | 1.6 s |
| long | 34 | **34** | 2.3 s |

Latency is on the same class as the spike numbers (1.6 / 1.7 / 2.5 s) on a loaded box. Pixel
fidelity against the desktop PDF was measured on the spike build only and was not re-run
here; page counts are the cheap regression check, and the pixel diff scripts below still apply.

## Recommendation

**(b) Headless Chromium rendering the pinned Docs web bundle, run as an office-engine
job (`export`, docx → pdf).** Its output matches desktop page for page. On two of the
three fixtures it is pixel-identical. LibreOffice re-paginates (34 → 46 pages on
`long.docx`), substitutes fonts and drops content, so it cannot produce "the PDF of
what I see". The prototype is implemented and tested (see *What landed*). Production
needs the renderer staged into the engine image and a larger per-job memory limit
(see *Before turning it on*).

## Measurements

Box: the lane VPS, Linux arm64, 4 vCPU, 23 GB RAM. Other lane workers were building
and testing at the same time (load average ~10), so latencies are biased upward.
Fixtures are the three spike fixtures: `fixtures/generated/simple.docx`,
`fixtures/generated/kitchen-sink.docx` and `web/fixtures/long.docx` (fork 4a70857).

- **Baseline:** desktop `--headless-export <docx> --to pdf`, the shell app's real
  export path (Electron 43.3.0 / Chromium 150, under xvfb). It is the renderer's own
  `exportPdf` → `webContents.printToPDF`.
- **(b):** the web build in Chromium headless-shell 151. A page shim answers the
  renderer's `exportPdf` / `printPdfBuffer` / `saveMergedPdf` with `printToPDF`, using
  the exact options desktop main passes: page size in inches from twips, zero margins,
  `printBackground`, and the renderer's scale.
- **(a):** LibreOffice 7.4.7 (Debian bookworm arm64 container with Noto, Noto CJK,
  Liberation and DejaVu fonts), `soffice --headless --convert-to pdf`.

### Fidelity against the desktop PDF

Pixel diff: both PDFs rasterised at 96 dpi in grey; a pixel counts as different when
it differs by more than 32/255. Page counts come from `pdfinfo`, fonts from
`pdffonts`, text from `pdftotext -layout`.

| Fixture | Desktop pages | (b) pages | (b) pixels differing | (b) fonts / text | (a) pages | (a) pixels differing | (a) fonts |
|---|---|---|---|---|---|---|---|
| simple | 1 | 1 | **0.000 %** (identical) | same / same | 1 | 0.17 % | Noto Sans CJK SC → Noto Serif CJK JP |
| kitchen-sink | 1 | 1 | **0.341 %** (one paragraph, see below) | same / 3 lines differ | 1 | 3.23 % | Carlito → Noto Sans; CJK → serif JP; FreeSans and Liberation Serif dropped |
| long (tables, ~41 preview pages) | 34 | 34 | **0.000 %** (all 34 pages identical) | same / same | **46** | 18.3 % mean (pages shifted) | Carlito → Noto Sans |

The one (b) difference is in kitchen-sink. Full-width CJK punctuation (`，` `：`) is set
proportionally instead of with a full-width gap, which shifts the rest of that line
and the equation line by about one character. It is not a Chromium version effect:
Chromium headless-shell 149, headless-shell 151 and full Chromium 151
(`--headless=new`) all give the same 0.341 %. The likely cause is a desktop-only
bridge call. `fontMetrics` parses installed font files on desktop and returns `null`
on the web (`web/docs/bridge/browser.ts`), so the renderer's line metrics differ.
That is a follow-up in the fork, not a renderer choice.

What LibreOffice gets wrong on kitchen-sink, visible in the renders:

- list bullets come out as tofu;
- the equation `E = mc^2` is missing;
- the two-column table is stretched to full width;
- headings use a different face.

On `long.docx` it adds 12 pages.

### Latency and memory (arm64)

| Arm | Per document | Peak RSS (process tree) |
|---|---|---|
| Desktop baseline, one Electron process per document (includes app boot) | 5.1–11.7 s | 843–929 MB |
| (b) Playwright harness, cold (launch + render, one process per document) | 4.6–6.1 s wall; render 2.8–4.7 s | 652–688 MB |
| (b) Playwright harness, warm (one browser, 9 renders) | 2.2–3.6 s per document | 708 MB |
| **(b) engine prototype** (`docs-pdf.ts`, raw CDP, Chromium spawned per job) | **1.6 / 1.7 / 2.5 s** render, 2.0 / 2.1 / 2.8 s wall (simple / kitchen-sink / long) | **687–711 MB** |
| (a) LibreOffice, one container per document | 1.6–3.0 s (includes `docker run`) | ~160 MB (cgroup peak); image 888 MB |

LibreOffice is lighter. Chromium's ~700 MB peak is real and sets the engine's limit
(see *Before turning it on*). Latency is comparable, and (b) is fast enough for a
synchronous request.

## What landed (prototype)

**Route.** `POST /api/v1/office-frame/documents/{documentID}/export/pdf`:

- **Auth:** frame-token Bearer only, behind the `documents` and `office_docs_web`
  flags. It needs only view access, because an export is a read.
- **Budget:** 20 requests per minute per verified frame user.
- **Body:** none (or an empty multipart body) exports the current version. A
  multipart `file` part carries the frame's unsaved DOCX, for when the editor is
  dirty; a `version` field renders that stored version instead. `file` and
  `version` are exclusive.
- **Idempotency:** an optional `Idempotency-Key` replays the render; reusing it with
  different bytes is refused.
- **Response:** `200 application/pdf` (the bytes the protocol's `api.export`
  returns).
- **Errors:** no engine → 503 `office_not_configured`; an engine without export → 501
  `unsupported_operation`; a deadline → 504 `engine_timeout`.

Files: `server/internal/handler/router/office_frame_export.go`,
`server/internal/handler/office_frame_export.go` and
`server/internal/service/office_frame_export.go`.

**Pipeline.** The export is an ordinary office job, `operation: export`,
`format: docx`, `target_format: pdf`. It binds the operation the contract had
reserved, so it inherits:

- the signed per-job grant, which binds the rendered bytes' checksum;
- the engine's uid sandbox, limits and process-tree kill;
- the FileService provider-output intent and verification;
- idempotency and tenant scoping.

The public `POST /documents/{id}/office/jobs` still refuses `export`, and an export
output can never be committed as a version (`office_job_export_not_a_version`).

**Audit.** An export changes no business state. Its record is the `office_jobs` row
plus a `document_access_logs` row with action `export`, written through
`RecordDocumentRead`. It emits no outbox event.

**Engine.** `export:docx` in `apps/office-engine/src/worker/handlers.ts` and
`docs-pdf.ts` drives Chromium over `--remote-debugging-pipe`, with no automation
dependency:

- The pinned bundle and the input are served from a loopback server that lives only
  for the job, and every other host resolves to nothing.
- Parts from the renderer's chunked or mixed-paper path are merged in page order
  with the PDF lane's `mergePdfBytes`.
- The job fails `engine_incompatible` when `UNIWORK_DOCS_PDF_ASSETS`
  (`bundle/` + `chromium`) is not staged.
- `packages/office-contracts` lets the export payload carry the input bytes, as
  convert's does.

## Before turning it on

1. **Image.** Stage a headless Chromium (chrome-headless-shell or Debian `chromium`,
   for arm64 and amd64) and the Docs web bundle into the engine image under
   `UNIWORK_DOCS_PDF_ASSETS`. The bundle must be built from the same fork SHA the
   frame serves (W7's sync script). This needs a Dockerfile change, which was not
   done here because image builds are serialized lane-wide. Check CJK fallback inside
   the slim image: the measurements ran on a host with system fonts.
2. **Memory.** Raise `OFFICE_ENGINE_MEMORY_MB` to at least 1024 (or add a per-operation
   limit). A render peaks at ~700 MB for the job tree, so the 512 MiB default would
   kill it as `memory_limit`.
3. **Sandbox review.** Chromium runs with `--no-sandbox` inside the job's slot uid and
   the container, with network access limited to loopback. Consider seccomp or landlock
   on top.
4. **Frame and host.** The frame's `api.export` (W3b, optional `data` when dirty) goes
   through the host proxy (W5d), whose `createOfficeFrameClient().exportPdf` in
   `packages/core/api/endpoints/office-frame.ts` calls this route with `file`,
   `version` or neither.
5. **CJK punctuation follow-up.** Implement `fontMetrics` for the web bridge (or in the
   engine's page shim, from the bundle's fonts) and re-measure kitchen-sink.

## Reproduce

Scripts are in `docs/office/pdf-export/`:

- `render-web.mjs` is arm (b) with Playwright, run against a fork checkout.
- `measure.py` reports wall time and process-tree peak RSS.
- `pixdiff.py` does the 96 dpi grey pixel diff.

To get the desktop baseline:

```sh
xvfb-run -a node_modules/electron/dist/electron --no-sandbox apps/shell \
  --headless-export <docx> --to pdf --out <pdf> --json
```

Run that in the fork after `npm run build -w @genoffice/docs` and
`npm run build -w @genoffice/shell`.

To run the engine's real-renderer tests, point `UNIWORK_DOCS_PDF_TEST_ASSETS` at a directory
holding `bundle/` (the **pinned** build: `apps/web/public/office-frame/docs/<version>`) and
`chromium`; `UNIWORK_DOCS_PDF_TEST_FIXTURES` is a fork checkout, for the three measured
fixtures (1 / 1 / 34 pages):

```sh
UNIWORK_DOCS_PDF_TEST_ASSETS=<dir with bundle/ + chromium> \
UNIWORK_DOCS_PDF_TEST_FIXTURES=<fork checkout> \
  pnpm --filter @uniwork/office-engine-app exec vitest run src/worker/docs-pdf.test.ts
```

## Confinement of the renderer

The job renders an untrusted DOCX in Chromium, so three things hold it:

- **Network:** `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` leaves only
  loopback. Loopback also hosts the engine's own listener, so the driver adds a CDP `Fetch`
  interceptor that fails (`BlockedByClient`) every request whose origin is not this job's own
  `http://127.0.0.1:<port>` (data:, blob: and about: stay). The loopback server also sends
  the bundle's own `csp.json` policy (a strict fallback if it is unreadable).
- **Sandbox:** `--no-sandbox` is passed only when the job runs under the engine's per-slot
  uid sandbox (`RunMessage.sandboxed`), which is what confines it in a container where
  Chromium's namespace sandbox cannot start. Without it (`OFFICE_ENGINE_SANDBOX=off`, a
  non-root dev run) the job is refused as `engine_incompatible` / `sandbox_required`; it is
  never run unconfined.
- **Memory:** `--disable-dev-shm-usage` (a container's 64 MiB `/dev/shm` crashes Chromium on a
  large document); the job tree is still limited by `OFFICE_ENGINE_MEMORY_MB`.
