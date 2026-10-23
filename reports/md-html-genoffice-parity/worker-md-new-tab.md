# UNI-928 md-new-tab worker report

## Root cause
`apps/office-desktop/main/ipc.ts` creates blank Markdown as zero bytes and correctly returns `dataBase64: ""`; `shared/ipc.ts` accepts empty base64. Renderer `acceptLocal` in `renderer/desktop-workspace.tsx` used a falsy check (`!result.dataBase64`), so the valid empty payload threw `invalid_file`; `perform` swallowed that exception behind the generic action error alert.

## Fix
The renderer now rejects only an omitted `dataBase64` (`=== undefined`), allowing valid empty Markdown while retaining metadata and format validation. The local-mode harness now models format-specific blank responses and covers blank Markdown/HTML creation plus opening an existing zero-byte Markdown file.

## Verification
- Focused blank Markdown/HTML tests: 2 passed.
- Focused existing empty Markdown test: 1 passed.
- Broader local-mode run was attempted but emitted pre-existing jsdom CSS parse noise from the DOCX renderer and was stopped.
- Electron build/launch was not run per the RELAUNCH host-free restriction.

## Commit
Pending commit on `feature/UNI-928-fix-md-new-tab`.
