# XLSX editor capability map (G3-05 / UI 05a)

This map is the UI hand-off for every mandatory XLSX Q1-B row in
`docs/office/g3g4/capability-rows.json`. The view consumes the browser-safe
`@uniwork/office-engine/xlsx` facade and the G3-01 `EditorHandle`; it does not
call the Node/native entry, a filesystem, or a byte upload API. Status describes
what this UI slice can honestly expose at the G2 build. `pending-05b` means the
real H1 save/recalculate/reopen loop is deliberately outside this slice.

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
| `CAP-xlsx-save` / `xlsx-save` | Save button and Ctrl/Cmd+S | G2-04 serialize + G3-01 coordinator | Coordinator intent/receipt; H1 version and bytes oracle | **pending-05b** | Toolbar has no byte path; real upload/commit/reopen is 05b. |
| `CAP-xlsx-recalculate` / `xlsx-recalculate` | Recalculate and progress/cancel controls | G2-02 native recalc through the G2 port; no browser evaluator | Port result applied only on success; failed/timeout result remains not-fresh | **supported** | UI progress/cancel is covered here; real native service loop is 05b. |
| `CAP-xlsx-cross-sheet-formulas` / `xlsx-cross-sheet-formulas` | Formula bar and sheet tabs | G2-04 basic workbook model | Cross-sheet formula extraction and reopen oracle | **engine-gap** | The public browser model does not prove defined-name/cross-sheet coverage in this build. |
| `CAP-xlsx-charts` / `xlsx-charts` | Chart command (disabled with reason) | G2-04 preserves chart parts but does not edit them | Package-part preservation and chart object oracle | **engine-gap** | Charts remain byte-preserved and explicitly unavailable for editing. |
| `CAP-xlsx-conditional-formatting` / `xlsx-conditional-formatting` | Number/style commands (disabled where unsupported) | G2-04 cell edits; conditional-format parts preserved | Conditional-format part preservation oracle | **engine-gap** | No public browser operation edits conditional formatting. |
| `CAP-xlsx-data-validation` / `xlsx-data-validation` | Cell/range selection; validation command unavailable | G2-04 cell/range selection only | Data-validation part preservation oracle | **engine-gap** | No public browser operation edits validation rules. |
| `CAP-xlsx-pivot` / `xlsx-pivot` | Pivot command (disabled with reason) | G2-04 preserves pivot parts | Pivot part preservation oracle | **engine-gap** | Pivot editing is not exposed by the public facade. |
| `CAP-xlsx-protection` / `xlsx-protection` | Protected workbook opens read-only when the host reports the capability | G2-04 capability result + host permission | Typed capability status and no mutation when read-only | **engine-gap** | Protection-aware edit operations are not bound by the browser facade. |
| `CAP-xlsx-export-pdf` / `xlsx-export-pdf` | Export command is not rendered as an enabled action | G2-04 export row | Typed unavailable capability, no fake export | **engine-gap** | G2 reports no export channel; conversion/export remains outside 05a. |
| `CAP-xlsx-native-sidecar-build` / `xlsx-native-sidecar-build` | Recalculate command is enabled only when the host injects the G2 recalc port | G2-02 Rust sidecar via service port | Recalc progress/cancel fault tests and sidecar contract | **pending-05b** | Browser UI cannot build or launch native code; service packaging/evidence belongs to 05b. |

The map intentionally keeps unsupported rows visible in the toolbar as disabled
commands with a reason. A disabled row is not treated as a text-only grid
capability, and no engine gap is hidden behind a successful-looking Save.
