# Desktop Office capability matrix

UNI-835 desktop library and DOCX slice. Implementation and automated evidence are listed below; final independent review and visual acceptance must be attached to the final SHA before this lane is accepted.

| Format | Open | Edit | Save | Status | Evidence |
|---|---|---|---|---|---|
| DOCX | shared OfficeShell / EditorSlot / DocxEditor | blocked: G3 content surface missing | explicit byte-preserving coordinator Save to cloud or local handle | implemented; final visual verification pending | `apps/office-desktop/renderer/office/open-document.tsx`, `session.ts`, `session.test.ts`, `renderer/app.test.tsx` |
| XLSX | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| PPTX | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| PDF | no | no | no | not supported | no desktop IPC or engine acceptance evidence |
| Markdown or HTML | no | no | no | not supported | desktop capability deliberately excludes browser source editors |

The desktop library filters to file DOCX rows and keeps download available when the engine is down. Main reads the server capability response instead of asserting that the engine is available. Work Product rows are excluded. Local file open uses an opaque main-process handle and bounded bytes; filesystem paths stay inside the Electron preload/main boundary.

New DOCX creation uploads an original minimal OOXML template through the Documents file-creation route, which creates its first version. Provenance and the template checksum are documented in `apps/office-desktop/main/files/blank-docx.ts`. It does not depend on the server blank generator, which supports only Markdown and HTML.

The native picker, dropped files and OS open events use the same file registry. Main encrypts local snapshots through the existing G4-04 draft store and protects its separate key with OS safeStorage; a locked store refuses the checkpoint. Save preserves the registry's external-modification checks. Cloud Save and native-menu Save share the G3 coordinator and one intent/idempotency key. Engine serialization currently preserves the opened bytes; no text mutation is claimed.

| Acceptance row | Evidence / remaining verification |
| --- | --- |
| G4-A05 library scope and context | `renderer/library/model.test.ts`, `renderer/app.test.tsx`; real display names, workspace picker, Work Product filtering, request failure and Retry |
| G4-A06 DOCX host and save | `renderer/office/session.test.ts`, `renderer/app.test.tsx`; shared editor mounting, snapshot bytes, concurrent Save rejection, native-menu action |
| G4-A07 local file open/save | `main/files/registry.test.ts`, `main/files/protected-files.test.ts`; picker/drop/native-event wiring, encrypted checkpoint, local save transport |
| G4-A08 launch ticket | `renderer/app.test.tsx`, `preload/index.test.ts`; queued ticket and picked workspace/version; no overwrite of an already open editor |
| G4-A09 capability limits | DOCX only; other formats explicitly unsupported; protected local draft recovery UI remains owned by G4-04 |

## Acceptance limitations

The real AC-4 edit step is blocked: the shared DOCX editor has no content editing surface in this checkout (G3-04c owns that port). The shared editor is mounted and explicit Save runs on the opened bytes, but this lane does not claim a visible text edit or reopen-after-edit pass. See the binding r4 item 10 instruction; desktop host integration is not deferred.

401 refresh is wired from Electron to `NativeLoginManager.refreshSession`. Tests cover concurrent expired calls, failure, one retry limit and account-switch isolation (`main/transport/office-transport.test.ts`).

DOCX association metadata and native open-event handling are implemented, but Windows installer registration / actual Open With has not been exercised in this fix round. It must be reported as unverified, not inferred from a passing package build. No global registry changes or installer run are claimed.
