# UniWork Office — ma trận năng lực G0 (DOC-002)

> **Trạng thái:** in-progress — bàn giao Task 2 (2026-09-16). Sinh từ `capabilities.json` và `fixtures/manifest.json`.
> Bảng này **không** phải bằng chứng đã chạy: mọi ô vẫn `chưa thử`.
>
> Sinh lại bằng `node scripts/office-g0/verify-manifest.mjs --write-matrix`; không sửa tay file này.

**Issue:** UNI-666 (DOC-002) · **Parent:** UNI-656 · **Kế tiếp:** UNI-667 (DOC-003) dùng bảng này để biết cần chứng minh gì.

Khoá đọc: `upstream có` = có mã ở commit đã pin; `phải port` = thuộc phạm vi pilot Q1-B; `web đã chứng minh` và `desktop đã chứng minh` = cần một lần chạy thật trong browser/desktop.

Nút UI, menu, filter hộp thoại và route table chỉ là bằng chứng **upstream có**, không bao giờ là đạt. Theo Q1-B, một thao tác upstream có hỗ trợ nhưng bản web chưa chạy được là thiếu/blocker, không được xoá khỏi tập yêu cầu bằng cách đổi nhãn.

## 1. Ma trận

### DOCX — 22 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `docx-open` | docx | open in editor | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-SIMPLE`, `F-DOCX-KITCHEN`, `F-DOCX-VI`, `F-LARGE-DOCX`, `F-DOCX-EXPANSION`, `F-DOCX-DEEP-NEST` |
| `docx-edit-text` | docx | edit text | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-KITCHEN`, `F-DOCX-VI` |
| `docx-edit-table-image` | docx | edit table and image | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-TABLE-IMG`, `F-DOCX-LONGTABLE` |
| `docx-save-docx` | docx | save docx | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-KITCHEN`, `F-DOCX-TABLE-IMG`, `F-DOCX-THEME` |
| `docx-export-pdf` | docx | export to pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-KITCHEN`, `F-DOCX-FR-JUSTIFY` |
| `docx-create-blank` | docx | create blank document | có | phải port | chưa thử | chưa thử | — | `F-DOCX-EMPTY` |
| `docx-convert-to-md` | docx | convert docx to md | có | phải port | chưa thử | chưa thử | — | `F-DOCX-KITCHEN` |
| `docx-convert-to-html` | docx | convert docx to html | có | — | chưa thử | chưa thử | — | `F-DOCX-KITCHEN` |
| `docx-content-headings-lists` | docx | content: headings and list numbering | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-KITCHEN`, `F-DOCX-NUMBERED-LIST`, `F-DOCX-VI` |
| `docx-content-footnotes` | docx | content: footnotes and endnotes | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-FOOTNOTES`, `F-DOCX-VI` |
| `docx-content-comments-revisions` | docx | content: comments and tracked changes | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-REVISIONS` |
| `docx-content-equations` | docx | content: equations (OMML) | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-EQUATION` |
| `docx-content-fields-toc` | docx | content: fields and table of contents | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-TOC` |
| `docx-content-charts` | docx | content: charts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-CHART` |
| `docx-content-watermark` | docx | content: watermark | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-WATERMARK` |
| `docx-content-sections-columns` | docx | content: sections, columns and page colour | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-2COL`, `F-DOCX-THEME` |
| `docx-content-drawing-anchors` | docx | content: float (captioned table); inline and page-anchor exist upstream but are not yet cased | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-CAPTABLE-FLOAT` |
| `docx-content-embedded-fonts` | docx | content: embedded fonts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-EMBEDDED-FONT` |
| `docx-protection` | docx | edit protection with password | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-PROTECTED` |
| `docx-encrypted-open` | docx | open password-encrypted docx | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-DOCX-PWD-STANDARD`, `F-DOCX-PWD-AGILE`, `F-DOCX-PWD-AGILE-PLAIN` |
| `docx-text-extract` | docx | extract plain text | có | — | chưa thử | chưa thử | — | `F-DOCX-KITCHEN` |
| `docx-pagination-fidelity` | docx | pagination and layout fidelity | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-DOCX-FR-JUSTIFY`, `F-DOCX-LONGTABLE`, `F-DOCX-KITCHEN`, `F-LARGE-DOCX`, `F-DOCX-2COL` |

Ghi chú của nhóm này:

- `docx-open` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file. F-DOCX-EXPANSION and F-DOCX-DEEP-NEST are negative/complexity cases for this row: they state the required refusal/bounded handling and can never mark the row as proven. F-LARGE-DOCX/F-LARGE-XLSX now carry an on-disk band (49 MiB <= bytes < 50 MiB) because Q9-A is a real file band, not a content target.
- `docx-text-extract` — not part of the interactive pilot; used by attachments
- `docx-pagination-fidelity` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file.

### XLSX — 16 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xlsx-open` | xlsx, xlsm, xls, csv | open in editor | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-XLSX-BASIC`, `F-XLSX-KITCHEN`, `F-XLSX-VI`, `F-LARGE-XLSX` |
| `xlsx-edit-cells` | xlsx | edit cells | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-XLSX-EDIT`, `F-XLSX-VI`, `F-LARGE-XLSX`, `F-XLSX-KITCHEN`, `F-XLSX-SHEETS` |
| `xlsx-save` | xlsx, xlsm, csv | save | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-XLSX-EDIT`, `F-XLSX-STRUCT` |
| `xlsx-recalculate` | xlsx, xlsm | recalculate formulas | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-XLSX-VI`, `F-XLSX-BASIC` |
| `xlsx-cross-sheet-formulas` | xlsx | cross-sheet and defined-name formulas | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-VI`, `F-XLSX-SHEETS` |
| `xlsx-charts` | xlsx | charts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-CHART`, `F-XLSX-VI`, `F-XLSX-KITCHEN` |
| `xlsx-conditional-formatting` | xlsx | conditional formatting | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-STRUCT`, `F-XLSX-KITCHEN` |
| `xlsx-data-validation` | xlsx | data validation | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-STRUCT`, `F-XLSX-KITCHEN` |
| `xlsx-pivot` | xlsx | pivot tables | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-PIVOT` |
| `xlsx-protection` | xlsx | sheet and range protection | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-PROTECTED` |
| `xlsx-export-pdf` | xlsx, xlsm | export to pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-BASIC`, `F-LARGE-XLSX` |
| `xlsx-convert-external-to-xlsx` | csv, xls, xlsb, ods | convert external format to xlsx | có | — | chưa thử | chưa thử | — | `F-XLSX-BASIC` |
| `xlsx-convert-to-csv` | xlsx, xlsm | convert to csv | có | — | chưa thử | chưa thử | — | `F-XLSX-BASIC` |
| `xlsx-macro-preserve-not-execute` | xlsm | preserve macros without executing them | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-MACRO` |
| `xlsx-text-extract` | xlsx, xlsm | extract plain text | có | — | chưa thử | chưa thử | — | `F-XLSX-BASIC` |
| `xlsx-native-sidecar-build` | n/a | build the Rust recalculation sidecar | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-BASIC` |

Ghi chú của nhóm này:

- `xlsx-open` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file.
- `xlsx-edit-cells` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file.
- `xlsx-save` — the MCP save path still forces .xlsx although the interactive Save As offers xlsm and csv
- `xlsx-recalculate` — missing recalculation is a blocker per the plan's Task 3 table
- `xlsx-export-pdf` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file.
- `xlsx-macro-preserve-not-execute` — the harness never runs a macro; the vbaProject part must survive a save byte-identical
- `xlsx-text-extract` — file-parse has no .xls, .ods or .xlsb branch

### PPTX — 15 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pptx-open` | pptx | open in editor | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PPTX-STD`, `F-PPTX-UNICODE` |
| `pptx-edit-text` | pptx | edit text | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PPTX-STD`, `F-PPTX-VI` |
| `pptx-edit-shape-image` | pptx | edit shapes and images | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PPTX-VI` |
| `pptx-save` | pptx | save | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PPTX-STD`, `F-PPTX-VI` |
| `pptx-export-pdf` | pptx | export to pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-STD` |
| `pptx-notes` | pptx | speaker notes | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-NOTES` |
| `pptx-masters-layouts` | pptx | masters and layouts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-STD` |
| `pptx-animations` | pptx | animations and transitions | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-ANIM` |
| `pptx-charts` | pptx | charts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-CHART` |
| `pptx-tables` | pptx | tables | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-TABLE` |
| `pptx-embedded-fonts` | pptx | embedded fonts | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-EMBEDDED-FONT` |
| `pptx-comments` | pptx | comments | có | — | chưa thử | chưa thử | — | `F-PPTX-STD` |
| `pptx-render-fidelity` | pptx | render tree and text shaping fidelity | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PPTX-UNICODE`, `F-PPTX-VI` |
| `pptx-text-extract` | pptx | extract plain text | có | — | chưa thử | chưa thử | — | `F-PPTX-STD` |
| `pptx-audit` | pptx | deck audit and QC | có | — | chưa thử | chưa thử | `ADV-002` | `F-PPTX-STD` |

### PDF — 17 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pdf-open-view` | pdf | open and view | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PDF-TEXT`, `F-PDF-CORRUPT` |
| `pdf-edit-text-in-place` | pdf | edit existing text in the content stream | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PDF-TEXT` |
| `pdf-edit-image` | pdf | edit and replace images | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PDF-IMAGE` |
| `pdf-save` | pdf | save | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-PDF-TEXT` |
| `pdf-export-docx` | pdf | convert to docx | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PDF-TEXT` |
| `pdf-export-xlsx` | pdf | convert to xlsx | có | — | chưa thử | chưa thử | — | `F-PDF-TABLE` |
| `pdf-export-pptx` | pdf | convert to pptx | có | — | chưa thử | chưa thử | — | `F-PDF-TEXT` |
| `pdf-annotations-stamps` | pdf | annotations, stamps and ink | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PDF-TEXT` |
| `pdf-forms` | pdf | form fields | có | — | chưa thử | chưa thử | — | `F-PDF-FORM` |
| `pdf-signature` | pdf | signature placement | có | — | chưa thử | chưa thử | — | `F-PDF-TEXT` |
| `pdf-page-ops` | pdf | page operations (insert, delete, rotate, reorder, extract, merge) | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PDF-TEXT` |
| `pdf-metadata` | pdf | document metadata and properties | có | — | chưa thử | chưa thử | — | `F-PDF-TEXT` |
| `pdf-password-open` | pdf | open a password-protected pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PDF-PWD4SP`, `F-PDF-CERT` |
| `pdf-corrupt-handling` | pdf | reject a corrupt file with a clear error | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-PDF-CORRUPT` |
| `pdf-ocr-scan` | pdf | OCR a scanned page | có | — | chưa thử | chưa thử | `OCR` | `F-PDF-SCAN` |
| `pdf-text-extract` | pdf | extract plain text | có | — | chưa thử | chưa thử | — | `F-PDF-TEXT` |
| `pdf-print` | pdf | print | có | — | chưa thử | chưa thử | — | `F-PDF-TEXT` |

Ghi chú của nhóm này:

- `pdf-edit-text-in-place` — MCP formats.ts calls the pdf app a viewer with read-only text extraction; the IPC and main-process implementations contradict that comment, and the plan forbids concluding from the package description
- `pdf-corrupt-handling` — the failure must be reported as a specific error, never a generic one
- `pdf-ocr-scan` — Q2-A: OCR is deferred past M1; overlay annotations do not satisfy the text-edit requirement

### Markdown — 9 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `md-open` | md, markdown | open in editor | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-MD-VI`, `F-MD-FULL` |
| `md-save` | md, markdown | save source | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-MD-VI`, `F-MD-FULL` |
| `md-content-blocks` | md | content: tables, code blocks, Unicode | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-MD-FULL`, `F-MD-VI` |
| `md-content-math-mermaid` | md | content: math and mermaid diagrams | có | — | chưa thử | chưa thử | — | `F-MD-FULL` |
| `md-content-frontmatter` | md | content: YAML frontmatter | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-MD-FRONTMATTER` |
| `md-content-local-assets` | md | relative image and asset links | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-MD-ASSET` |
| `md-export-docx` | md | export to docx | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-MD-VI` |
| `md-export-pdf` | md | export to pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-MD-VI` |
| `md-export-html` | md | convert to html | có | — | chưa thử | chưa thử | — | `F-MD-VI` |

### HTML — 8 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `html-open` | html, htm | open in editor | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-HTML-VI` |
| `html-save` | html, htm | save source | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-HTML-VI`, `F-HTML-ASSET` |
| `html-preview-isolation` | html, htm | isolated preview | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-HTML-SCRIPT` |
| `html-content-assets` | html, htm | assets and single-file html | có | phải port | đạt có giới hạn | chưa thử | `Q1-B` | `F-HTML-ASSET`, `F-HTML-SINGLE` |
| `html-content-blocks` | html, htm | content: text, image, background and float | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-HTML-VI` |
| `html-export-pdf` | html, htm | export to pdf | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-HTML-VI` |
| `html-export-docx` | html, htm | convert to docx | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-HTML-VI` |
| `html2docx-browser-driver` | n/a | DOM extraction via a browser driver | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-HTML-VI` |

Ghi chú của nhóm này:

- `html-preview-isolation` — content must not read the app session or escape its origin
- `html2docx-browser-driver` — needs a real DOM and a script-injection channel; a UniWork host must provide both

### Legacy và định dạng dùng chung — 5 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `editor-open-unsupported` | doc, rtf, odt, ppt, pps, odp, ods, xlsb, pages, key, numbers | open in an editor | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-UNSUPPORTED-ODT`, `F-UNSUPPORTED-ODS`, `F-UNSUPPORTED-XLSB`, `F-UNSUPPORTED-RTF` |
| `editor-open-xls` | xls | open in an editor | có | phải port | chưa thử | chưa thử | `Q1-B` | `F-LEGACY-XLS` |
| `text-extract-legacy-doc` | doc | extract plain text | có | — | chưa thử | chưa thử | — | `F-LEGACY-DOC` |
| `text-extract-legacy-ppt` | ppt | extract plain text | có | — | chưa thử | chưa thử | — | `F-LEGACY-PPT` |
| `file-parse-image-multimodal` | png, jpg, gif, webp | flag an image as multimodal input | có | — | chưa thử | chưa thử | `ADV-002` | `F-IMG-SMALL` |

Ghi chú của nhóm này:

- `editor-open-unsupported` — the dialog is the expected result, not a silent failure
- `editor-open-xls` — asymmetry: .xls opens in the editor but file-parse has no .xls text branch

### Cross-format — 3 dòng

| ID | Định dạng | Thao tác | upstream có | phải port | web đã chứng minh | desktop đã chứng minh | Tag | Fixture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mcp-agent-drive` | docx, xlsx, pptx, pdf | drive editors through the MCP server | có | — | chưa thử | chưa thử | `ADV-002` | `F-DOCX-SIMPLE`, `F-XLSX-BASIC`, `F-PPTX-STD`, `F-PDF-TEXT` |
| `cli-headless-convert` | docx, xlsx, pptx, pdf, md, html, csv, xls | headless conversion and audit | có | — | chưa thử | chưa thử | `ADV-002` | `F-DOCX-SIMPLE`, `F-XLSX-BASIC`, `F-PPTX-STD`, `F-DOCX-KITCHEN` |
| `office-engine-service-placement` | n/a | run an engine outside the browser or desktop host | không | phải port | chưa thử | chưa thử | `Q1-B` | `F-XLSX-BASIC`, `F-PDF-TEXT`, `F-LARGE-DOCX`, `F-LARGE-XLSX` |

Ghi chú của nhóm này:

- `mcp-agent-drive` — MCP exposure is a documented subset of the editor matrix and is not evidence that the editor matrix works
- `cli-headless-convert` — source read only; no CLI command was executed because the trial source has no built CLI
- `office-engine-service-placement` — Ca dải lớn phải sinh trước bằng generate-fixtures.mjs --large; checksum của nó không nằm trong manifest đã commit mà ở lab-record.json cạnh file.

## 2. Tổng hợp

| Số liệu | Giá trị |
| --- | --- |
| Dòng năng lực | 95 |
| Dòng có ít nhất một fixture tồn tại trong manifest | 95 |
| Dòng thuộc phạm vi pilot (phải port) | 72 |
| Dòng upstream không có đường triển khai | 1 |
| Fixture đã khai trong manifest | 68 |
| Dòng đã chứng minh trên web | 26 |
| Dòng đã chứng minh trên desktop | 0 |

## 3. Định dạng không được hỗ trợ theo thiết kế

| Định dạng | Lý do | Không được nhận là |
| --- | --- | --- |
| doc, rtf, odt, ppt, pps, odp, ods, xlsb, pages, key, numbers | no editor implementation at the pinned commit; the shell shows an explicit not-supported dialog | the product must not describe these as editable |
| macros in docx, xlsx, pptx | macros are preserved but never executed by the harness or the lab | macro execution or calculation |

## 4. Khoảng trống đã biết

- webProven and desktopProven are 'chưa thử' for every row: no editor was executed. Separate upstream test and build baselines exist outside this lane and are prerequisites, not editor evidence.
- macOS and Safari are deferred (QA-01, UNI-671).
- The AI-assisted authoring surfaces (packages/pipelines, packages/agent-core, packages/ai-provider, packages/ai-search) are inventoried only where a task-3 row needs them; a full AI capability matrix is not an M1 requirement.
- packages/ai-search depends on the closed @genspark/cli; its licence and provenance are unresolved and are handed to task 4.
