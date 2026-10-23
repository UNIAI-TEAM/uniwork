# PDF capability map (G3-07a)

This map covers every mandatory PDF Q1-B row in
`docs/office/g3g4/capability-rows.json` and is checked against the pinned G0
inventory in `docs/office/g0/capabilities.json`. The view runs in a browser and
reaches the provider only through `@uniwork/office-engine/browser` envelopes and
`@uniwork/office-contracts`; it never imports the PDF engine, pdfium, pdf-lib,
an image codec, a filesystem API, or an upstream internal folder.

The engine build named by the lane is
`genoffice@09485f88+uniwork-office.0`; the public contract is
`uniwork-office-engine-contract/1`. `pending-07b` means that the real
two-save/reopen fixture and independent extraction/render oracle are intentionally
owned by 07b. A status here describes the UI contract and the known G2 seam; it
does not claim a production artifact or a fidelity pass.

| Mandatory Q1-B row | Command / toolbar item | Engine support and build | Oracle | Status |
| --- | --- | --- | --- | --- |
| `CAP-pdf-open-view` / `pdf-open-view` | Open PDF and page panel | G2-05 PDF adapter through browser `open` envelope; typed `OpenOutcome` | object/part: compare the declared fixture structure/content after a fresh reopen | **supported** |
| `CAP-pdf-edit-text-in-place` / `pdf-edit-text-in-place` | Edit existing text; text replacement control | G2-05 browser `edit` envelope (`replace_text`); no browser text parser | object/part: verify the edited content stream and that other pages are unchanged | **supported** |
| `CAP-pdf-edit-image` / `pdf-edit-image` | Replace image | G2-05 browser `edit` envelope (`replace_image`) with a provider asset reference; Node codec remains provider-side | object/part: verify image replacement and surrounding object/mask geometry | **supported** |
| `CAP-pdf-save` / `pdf-save` | Save button and Ctrl/Cmd+S | G3-01 coordinator calls G2-05 `serialize`; toolbar has no byte/upload/commit path | object/part: compare output after a fresh reopen and receipt/checksum | **pending-07b** |
| `CAP-pdf-export-docx` / `pdf-export-docx` | Convert to DOCX (disabled) | G2 public build has no browser-bound PDF conversion/export operation | extraction: compare converted DOCX after a fresh reopen | **engine-gap** |
| `CAP-pdf-annotations-stamps` / `pdf-annotations-stamps` | Annotation command remains separate and capability-gated | Annotation editing is not used as a substitute for content editing; the UI does not claim a bound annotation serializer in 07a | object/part: verify annotation objects and page content remain distinct | **pending-07b** |
| `CAP-pdf-page-ops` / `pdf-page-ops` | Insert, delete, rotate, reorder, extract, merge page commands | G2-05 browser `edit` envelope with page operation discriminants | extraction: verify page count/order/rotation and internal links after reopen | **supported** |
| `CAP-pdf-password-open` / `pdf-password-open` | Password open through the host open flow | G2-05 typed password-required/cancelled/wrong-password outcomes; password never cached by the view | object/part: verify unlocked content after reopen without leaking the password | **supported** |
| `CAP-pdf-corrupt-handling` / `pdf-corrupt-handling` | Typed parse/engine error state with Retry; no blank canvas or Save | G2-05 typed open failure; failed open stays attached to the document id | object/part: corrupt fixture yields a localized error and leaves the source unchanged | **supported** |

The G0 inventory also lists `pdf-ocr-scan` (`OCR a scanned page`). It is not a
mandatory Q1-B row: scanned/OCR PDFs stay out of Q2-A and the editor labels that
limitation instead of presenting OCR as ordinary text editing. Forms,
signatures, metadata, plain-text extraction, printing, and PDF-to-XLSX/PPTX
conversion likewise remain outside this 07a command surface when the inventory
does not mark them `mustPort`.

Missing embedded font faces are surfaced as a typed warning from the adapter;
the view never reports a missing face as present and never silently substitutes
one. Every Save goes through the G3-01 coordinator, so a second edit can be
captured for N+1 without the toolbar retaining stale bytes; the real two-save
fixture is evidence for 07b.
