# UNI-933 editor frame - adoption guide for lanes 925 (PDF), 926 (XLSX), 927 (PPTX), 928 (MD/HTML)

After the root carries UNI-933, merge root into your lane and move your format onto the shared frame. Your format
folder is yours; the shared files below are not - do not fork them, extend them on root if something is missing.
DOCX (`packages/views/office/docx/docx-editor.tsx`, `docx/status/status-bar.tsx`) is the worked example.

## What the shared layer gives you
- Tokens: `bg-office-band` (ribbon + status bar surface), `bg-office-canvas` (grey workspace), light + dark.
- `OfficeRibbon` (`packages/views/office/ribbon`): the root IS the band (grey surface, one bottom border, font-sans).
  Do not wrap it in another bordered/white container, do not add `border-b`/`bg-background` around it.
- Item sizes (F4): `large` = 32px icon + 2-line label, only for the first/primary item of a group (Paste, Table,
  Picture, New slide, Find...). Everything else `size: "icon"` (24px, tooltip = label + shortcut) packed in 2-3 rows
  with `rowBreak: true` on each row's first item, or `small` (icon + label, 24px rows) where Office shows labels.
  Split buttons (`kind: "split"`) for colour/list/underline variants. Never a lone large item beside small labelled ones.
- A `kind: "custom"` item declared `size: "icon"` (colour picker, size field) packs into the icon strip rows.
- Combos default 140px, min 56px (font family >= 140, size >= 56). Galleries (`kind: "gallery"`) = one bordered
  box of specimen + name cards with a "more" column (`maxVisible`, `minVisible`, `cardWidth`, `sample`).
- Group anatomy is automatic: caption at the bottom, launcher (`group.launcher`) bottom-right, inset separators.
- `OfficeFrame` (`packages/views/office/frame`): `ribbon`, `subbar` (formula bar / ruler / find bar, full width),
  `rail` (slide rail / PDF thumbnails, left), `aside` (right pane), `bottom` (PPTX notes, XLSX sheet tabs), `statusBar`,
  `children` = canvas content (scrolls, grey). Absent slots render nothing.
- `OfficeStatusBar` (`start`, `end`, `help`) one 28px row on the band surface + `OfficeStatusZoom` (− value% +,
  `onReset`, bounds) - use these instead of your own bar/zoom.

## Checklist per format (F1-F10; F1/F2/F8 blocking)
1. Mount: `<OfficeFrame ribbon={<OfficeRibbon .../>} subbar=... rail=... bottom=... statusBar={<OfficeStatusBar .../>}>`
   canvas `</OfficeFrame>` as the ONLY chrome of the ready state.
2. Delete inner cards and titles: no `rounded-* border` section around the editor, no `<header><h1>{title}` inside the
   editor (the page header owns the title), no "Save to UniWork" row (Save lives in the page header cluster), no
   outer padding (`p-3`, `p-4`) around the frame.
3. Undo/redo -> `quickAccess`; Find + per-format view toggles (Markdown/HTML Source | Split | Preview, PPTX present)
   -> `trailing` on the tab row; nothing in a separate row.
4. XLSX: formula bar (name box | fx | input) in `subbar`; sheet tabs in `bottom` or the status bar `start`.
   PPTX: slide rail in `rail`, notes in `bottom`. PDF: thumbnails in `rail`. Canvas content centred on the grey canvas,
   pages/slides with the surface shadow token.
5. Status bar: one row, no raw i18n keys (e.g. `office.html.status.figures` was shown raw), help "?" in `help`, zoom via
   `OfficeStatusZoom`. Nothing floats over the canvas or its scrollbar (C9).
6. Chrome text: `text-caption` / `text-label` / `text-body` only, semantic colours, packages/ui primitives.
7. Screenshots at 1440 light, 1440 dark, 390 light against
   `.uniwork-dev/office-g3g4/decisions/assets/ms-word-ribbon-reference-2026-10-05.png`.
