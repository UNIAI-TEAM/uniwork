# W-FIX-A - Home Font group defects (UNI-924 docx_genoffice_parity)

Base: `cc8dd312`. Owned files: `toolbar/groups/home-font.tsx`, `toolbar/tabs/home.tsx`,
`toolbar/groups/home-ribbon-items.test.tsx`.

## Findings fixed

### F3 (major) - font-size steppers + free-text size restored
The typed `combo` replaced the legacy `FontSizePicker` (`- [input] +`), so `stepFontSize`
was unreachable and non-preset sizes were unenterable. The size item is now a `custom`
ribbon item that re-mounts the existing `FontSizePicker`, keeping `docxFontSizeDisplay`
for the value/mixed state and calling `commands.setFontSizePt` / `commands.stepFontSize`
exactly as the pre-typed group did.

### F4 (minor) - font-family free text restored
The family item is a `custom` item that re-mounts the legacy `FontFamilyPicker`, which
commits a typed family name (Enter in the search field) and lists the built-in plus the
document's own fonts. The typed-name path the combo dropped is reachable again.

### F5 (major) - `documentFonts()` no longer walks the document per render
`homeFontRibbonItems` no longer calls `commands.documentFonts()` while building items.
The read now happens only when the family panel opens (`onOpen`), and the result is
cached in a module-level `WeakMap` keyed by the TipTap editor plus `editor.state.doc`
identity, so a selection-only change (same doc) reuses the cached list. Building the
items performs no document walk.

### F10 (nit) - Clipboard now collapses after Font
`home-clipboard` `collapseAt` lowered from 620 to 500, below Font's 560, so the leftmost
group stays visible longest (Word behaviour).

### F12 (nit) - test hygiene
`home-ribbon-items.test.tsx` now destroys every TipTap editor in `afterEach` and resets
`publishDocxEditor(null)` between tests. Added coverage for the F3/F4/F5 fixes (typed
size commit, +/- steps, mixed placeholder, typed family commit, lazy+cached font read).

### F7 - encoding
All touched files start without a UTF-8 BOM and end with LF (`home.tsx` had both a BOM
and one CRLF; both normalised).

## Verification

- `cd packages/views; pnpm test -- office/docx/toolbar/groups office/docx/character --coverage.enabled=false` -> 17 files / 96 tests passed.
- `cd packages/views; npx tsc --noEmit` -> clean.
- `cd packages/views; npx eslint <three files> --max-warnings 0` -> clean.
- No whole-suite run.
