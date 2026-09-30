# UniWork Office desktop capability matrix

Revision: UNI-835 (G4-06a), DOCX first slice. Evidence is scoped to the
desktop host and does not inherit a web capability result.

| Format | Open | Edit | Serialize / Save | Download | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| DOCX | supported | supported when the host reports `serialize` available | supported through G3 coordinator → G2 serializer → G1 upload/commit | supported with or without the engine | implemented in this slice | `apps/office-desktop/renderer/office/host.ts`, `apps/office-desktop/main/ipc.ts`, `packages/views/office/docx/` |
| XLSX | not supported | not supported | not supported | not supported in this slice | explicitly unsupported | G4-06b |
| PPTX | not supported | not supported | not supported | not supported in this slice | explicitly unsupported | G4-06b |
| PDF | not supported | not supported | not supported | not supported in this slice | explicitly unsupported | G4-06b |
| Markdown | not supported | not supported | not supported | not supported in this slice | explicitly unsupported | G4-06b |
| HTML | not supported | not supported | not supported | not supported in this slice | explicitly unsupported | G4-06b (preview remains gated by G3-D2) |

The library filters `owner_kind=work_product` rows and scopes every query to
the selected deployment/account/organization/workspace. Account or scope
changes clear the query cache before a new render; generation checks discard
late responses from the previous scope. If the engine is unavailable, committed
DOCX rows remain visible and their permission-checked download action remains
available. No local-file import, HTML preview process, Q7 consent, or other
format capability is implied by this matrix.
