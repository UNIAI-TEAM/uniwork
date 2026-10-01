# Desktop Office capability matrix

Evidence for UNI-835 desktop library and DOCX slice. The desktop host exposes only the DOCX row as supported; every other format remains explicitly unsupported until its engine and acceptance evidence exist.

| Format | Open | Edit | Save | Status | Evidence |
|---|---|---|---|---|---|
| DOCX | yes | host seam only | typed office-save coordinator path | supported for library transport; content editing blocked on G3 editor surface | `apps/office-desktop/shared/ipc.ts`, `renderer/office/host.ts`, `renderer/office/editor.ts`, focused host tests |
| XLSX | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| PPTX | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| PDF | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| Markdown or HTML | no | no | no | not supported | desktop capability deliberately excludes browser source editors |

The desktop library filters to file DOCX rows and keeps download available when the engine is down. Work Product rows are excluded by the renderer model filter. Local file open uses an opaque main-process handle and bounded bytes; paths never cross the renderer boundary.

## Acceptance limitations

The real AC-4 edit step is blocked: the shared DOCX editor content surface is owned by the G3 DOCX renderer lane and is not mounted in this slice. The desktop host and save coordinator seam are present and typed, so opening bytes and exercising Save transport can be tested independently, but this lane does not claim a visible text edit or reopen-after-edit pass.

401 refresh remains a follow-up: `NativeLoginManager.refreshSession` is single-flight and covered by auth transport tests, but `office-transport.ts` still maps a 401 directly to `login_required`. Wiring the manager into that transport requires an injected refresh callback and a focused replay test; it must be completed before a production acceptance claim.
