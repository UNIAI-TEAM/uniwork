# UNI-933 editor frame - plan (worker-office_editor_frame)

Binding: .uniwork-dev/office-g3g4/decisions/editor-frame-office-layout-2026-10-05.md (F1-F10) +
decisions/editor-chrome-layout-2026-10-04.md (C1-C12). Reference look: decisions/assets/ms-word-ribbon-reference-2026-10-05.png.

## Shared API (all subagents code against this; names are fixed)

Tokens (packages/ui/styles/tokens.css, :root AND .dark, plus the @theme `--color-*` mapping):
- `--office-band`  -> classes `bg-office-band`   (ribbon band + status bar surface; light ~#f5f5f6, dark ~#1a1a1a)
- `--office-canvas` -> classes `bg-office-canvas` (grey workspace behind pages; light ~#e8e8ea, dark ~#0b0b0b)

Frame (packages/views/office/frame/, exported from packages/views/office/index.ts):
```ts
export interface OfficeFrameProps {
  ribbon?: ReactNode;      // <OfficeRibbon>; the band itself owns surface + bottom border
  subbar?: ReactNode;      // full-width rows between ribbon and canvas: ruler, formula bar, find bar
  rail?: ReactNode;        // left rail inside the canvas row (slides, pdf thumbnails)
  aside?: ReactNode;       // right pane inside the canvas row (navigation, comments)
  bottom?: ReactNode;      // inside canvas column, under the canvas (pptx notes, xlsx sheet tabs)
  statusBar?: ReactNode;   // <OfficeStatusBar>
  children: ReactNode;     // canvas content
  canvasRef?: Ref<HTMLDivElement>;
  canvasClassName?: string;
  className?: string;
  "data-testid"?: string;
}
// root: data-office-frame, flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-office-canvas font-sans
// canvas: data-office-canvas, min-h-0 min-w-0 flex-1 overflow-auto bg-office-canvas
export function OfficeFrame(props: OfficeFrameProps): JSX.Element;

export interface OfficeStatusBarProps {
  start?: ReactNode;  // readouts (page x/y, words, language) - separated by middots by the caller or OfficeStatusText list
  end?: ReactNode;    // selection info, view modes, zoom
  help?: ReactNode;   // help "?" button, last item (F9)
  labelKey?: string;  // aria-label i18n key, default "office.status.label"
  className?: string;
}
// <footer role="status"? no: role="contentinfo" is page-level> -> use <div role="group" aria-label> ;
// one row, h-7 (28px), border-t border-border bg-office-band px-2 text-caption text-muted-foreground, data-office-status-bar
export function OfficeStatusBar(props: OfficeStatusBarProps): JSX.Element;
export function OfficeStatusZoom(props: { value: number | null; onZoomIn?: () => void; onZoomOut?: () => void; onReset?: () => void; min?: number; max?: number }): JSX.Element;
```

## Split (disjoint files)
- A ribbon band + tokens: packages/ui/styles/tokens.css (+ packages/ui/lib/utils.ts colour list if needed),
  ribbon/office-ribbon.tsx, ribbon/ribbon-tab-row.tsx (+ their tests).
- B group anatomy + items: ribbon/ribbon-group.tsx, ribbon/ribbon-item.tsx, ribbon/layout.ts, ribbon/types.ts,
  ribbon/index.ts (+ layout.test.ts, new tests). Keep 924 W-FIX-M/N/O behaviour.
- C frame: office/frame/*, office/index.ts, office-shell.tsx, editor-slot.tsx, documents/document-workspace.tsx,
  documents/document-file-view.tsx, core i18n locales (office.status.*), apps/office-desktop renderer check.
- D DOCX adoption (after A-C): docx-editor.tsx, docx/status-bar.tsx, docx/status/*, docx/shortcuts/docx-shortcuts-help.tsx,
  docx/toolbar/** data (sizes, combo widths, gallery), docx/view (ruler/canvas colours).
- E root formats xlsx/pptx/pdf/markdown/html: minimal structural adoption of OfficeFrame (lanes 925-928 own the rest).
