# XLSX editor capability map (G3-05 / UI 05a)

This map is the UI hand-off for every mandatory XLSX Q1-B row in
`docs/office/g3g4/capability-rows.json`. The view consumes the browser-safe
`@uniwork/office-engine/xlsx` facade and the G3-01 `EditorHandle`; it does not
call the Node/native entry, a filesystem, or a byte upload API. Status describes
what this UI slice can honestly expose at the G2 build. The 05b hand-off adds
the runtime/transport adapter and contract evidence. Rows that remain
`engine-gap` identify a missing production binding or server contract; no row
is promoted to supported without a real native loop and saved-file oracle.

The command surface is intentionally format-shaped rather than a text-only
grid: **Sheets** is the sheet tab strip; **Cells/ranges** is the workbook
selection and cell surface; **Formula** is the formula/value bar (formula text
is sent unchanged); **Number/cell format** is a capability-gated toolbar item;
and **Chart** is a capability-gated toolbar item. The last two remain visible
with an explanation when the engine cannot edit them.

| Capability row (G3/G0) | Command / toolbar item | Engine build and runtime | Oracle | Status | Reason / limit |
| --- | --- | --- | --- | --- | --- |
| `CAP-xlsx-open` / `xlsx-open` | Open slot and workbook surface | G2-04 browser facade, contract `xlsx/1` | Typed `OpenOutcome`; sheet names and cell snapshot rendered | **supported** | XLSX open is bound; XLSB, corrupt, and unsupported inputs use the typed error state. |
| `CAP-xlsx-edit-cells` / `xlsx-edit-cells` | Formula/value bar; cell selection; Edit cells | G2-04 browser facade, `set_cell`/`clear_cell`/`set_cells` | Snapshot cell/formula identity after the adapter edit | **supported** | The view sends public adapter ops and never replaces a formula with its displayed value. |
| `CAP-xlsx-save` / `xlsx-save` | Save button and Ctrl/Cmd+S | XLSX format adapter + G3-01 coordinator | Adapter contract test proves one intent, upload and commit with receipt checks; H1 saved-file oracle | **engine-gap** | The Go office job route now accepts bounded `edit` payloads and keeps ACL in the service; this checkout still needs the production browser runtime binding and saved-file oracle. |
| `CAP-xlsx-recalculate` / `xlsx-recalculate` | Recalculate and progress/cancel controls | Injected G2-02 native recalc port; no browser evaluator | Adapter fault test preserves model/freshness on rejection; native service loop evidence pending | **engine-gap** | The adapter propagates success, cancellation and timeout without stale values; the Go edit job is bound, while the browser host still needs its native recalc port wiring. |
| `CAP-xlsx-cross-sheet-formulas` / `xlsx-cross-sheet-formulas` | Formula bar and sheet tabs | G2-04 basic workbook model | Cross-sheet formula extraction and reopen oracle | **engine-gap** | The public browser model does not prove defined-name/cross-sheet coverage in this build. |
| `CAP-xlsx-charts` / `xlsx-charts` | Chart command (disabled with reason) | G2-04 preserves chart parts but does not edit them | Package-part preservation and chart object oracle | **engine-gap** | Charts remain byte-preserved and explicitly unavailable for editing. |
| `CAP-xlsx-conditional-formatting` / `xlsx-conditional-formatting` | Number/style commands (disabled where unsupported) | G2-04 cell edits; conditional-format parts preserved | Conditional-format part preservation oracle | **engine-gap** | No public browser operation edits conditional formatting. |
| `CAP-xlsx-data-validation` / `xlsx-data-validation` | Cell/range selection; validation command unavailable | G2-04 cell/range selection only | Data-validation part preservation oracle | **engine-gap** | No public browser operation edits validation rules. |
| `CAP-xlsx-pivot` / `xlsx-pivot` | Pivot command (disabled with reason) | G2-04 preserves pivot parts | Pivot part preservation oracle | **engine-gap** | Pivot editing is not exposed by the public facade. |
| `CAP-xlsx-protection` / `xlsx-protection` | Protected workbook opens read-only when the host reports the capability | G2-04 capability result + host permission | Typed capability status and no mutation when read-only | **engine-gap** | Protection-aware edit operations are not bound by the browser facade. |
| `CAP-xlsx-export-pdf` / `xlsx-export-pdf` | Export command is not rendered as an enabled action | G2-04 export row | Typed unavailable capability, no fake export | **engine-gap** | G2 reports no export channel; conversion/export remains outside 05a. |
| `CAP-xlsx-macro-preserve-not-execute` / `xlsx-macro-preserve-not-execute` | No macro command; macro parts are preserved by G2-04 | G2-04 package preservation guard, browser runtime | Saved-file part digest is required; no macro execution oracle is claimed | **engine-gap** | The adapter never executes macros, but byte-identical macro preservation cannot be reported until the production save/reopen route is bound. |
| `CAP-xlsx-native-sidecar-build` / `xlsx-native-sidecar-build` | Recalculate command is enabled only when the host injects the G2 recalc port | G2-02 Rust sidecar via service port | Adapter cancellation/failure contract test; service packaging evidence pending | **engine-gap** | Browser code exposes only the typed port; this lane does not build or launch native code and the web host binding is not present. |

The map intentionally keeps unsupported rows visible in the toolbar as disabled
commands with a reason. A disabled row is not treated as a text-only grid
capability, and no engine gap is hidden behind a successful-looking Save.
