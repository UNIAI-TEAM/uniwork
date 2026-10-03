// C1 (UNI-924): browser print for the open DOCX document.
//
// The vendored renderer sheet already drops the document's own editor
// furniture (page gaps, guide lines, resize handles) under @media print, but
// its chrome rules target genoffice class names (.ribbon, .status-bar, ...)
// which the UniWork shell does not carry. This module adds a print-only sheet
// for the UniWork chrome (never editing the vendored stylesheet): while the
// body carries the print marker, everything outside the paginated surface is
// hidden and the surface is unclipped so the browser prints the document
// alone. The marker is stamped by the print command and by beforeprint, so a
// native Ctrl+P on the editor page gets the same output once the sheet is
// installed.

export const DOCX_PRINT_ATTRIBUTE = "data-docx-printing";
export const DOCX_PRINT_STYLE_ID = "uniwork-docx-print-styles";
export const DOCX_PRINT_SURFACE_SELECTOR = '[data-testid="docx-document-surface"]';

const DOCX_PRINT_HIDE_SELECTORS = [
  '[data-testid="docx-toolbar"]',
  '[data-testid="docx-editor"] > header',
  '[data-testid="docx-find-panel"]',
  '[data-testid="docx-status-bar"]',
  '[data-testid="docx-view-chrome"]',
  '[data-testid="docx-image-layer"]',
  '[data-testid="docx-review-panel"]',
  '[data-testid="docx-notes-panel"]',
];

const DOCX_PRINT_EXPAND_SELECTORS = [
  '[data-testid="docx-editor"]',
  '[data-testid="docx-canvas"]',
  '[data-testid="docx-surface"]',
  DOCX_PRINT_SURFACE_SELECTOR,
];

/**
 * Print-only rules, all guarded by the body marker so printing any other page
 * of the app is untouched. The hide list removes the editor chrome from the
 * layout; the visibility pair then removes every remaining host element
 * (shell header, sidebars, panels) from the printed picture while the surface
 * subtree stays visible and is pinned to the top-left of the paper.
 */
export function docxPrintStyleSheet(): string {
  const marker = `body[${DOCX_PRINT_ATTRIBUTE}]`;
  const hide = DOCX_PRINT_HIDE_SELECTORS.map((selector) => `${marker} ${selector}`).join(",\n  ");
  const expand = DOCX_PRINT_EXPAND_SELECTORS.map((selector) => `${marker} ${selector}`).join(",\n  ");
  return [
    "@media print {",
    `  ${hide} {`,
    "    display: none !important;",
    "  }",
    `  ${expand} {`,
    "    display: block !important;",
    "    overflow: visible !important;",
    "    height: auto !important;",
    "    min-height: 0 !important;",
    "    flex: none !important;",
    "    background: none !important;",
    "  }",
    `  ${marker} ${DOCX_PRINT_SURFACE_SELECTOR} {`,
    "    position: absolute !important;",
    "    inset: 0 auto auto 0 !important;",
    "    width: 100% !important;",
    "    padding: 0 !important;",
    "  }",
    `  ${marker} * {`,
    "    visibility: hidden !important;",
    "  }",
    `  ${marker} ${DOCX_PRINT_SURFACE_SELECTOR},`,
    `  ${marker} ${DOCX_PRINT_SURFACE_SELECTOR} * {`,
    "    visibility: visible !important;",
    "  }",
    "}",
    "",
  ].join("\n");
}

const DOCUMENTS_WITH_PRINT_LISTENERS = new WeakSet<Document>();

function stampPrintMarker(target: Document): void {
  if (!target.body || !target.querySelector(DOCX_PRINT_SURFACE_SELECTOR)) return;
  target.body.setAttribute(DOCX_PRINT_ATTRIBUTE, "");
}

function clearPrintMarker(target: Document): void {
  target.body?.removeAttribute(DOCX_PRINT_ATTRIBUTE);
}

/**
 * Installs the print sheet once per document and wires beforeprint/afterprint
 * so native printing behaves like the command. Idempotent and safe to call
 * from an effect; no-op without a DOM (SSR).
 */
export function installDocxPrintStyles(target?: Document): void {
  const doc = target ?? (typeof document === "undefined" ? null : document);
  if (!doc?.head) return;
  if (!doc.getElementById(DOCX_PRINT_STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = DOCX_PRINT_STYLE_ID;
    style.dataset.uniworkDocxPrintStyles = "1";
    style.textContent = docxPrintStyleSheet();
    doc.head.appendChild(style);
  }
  if (DOCUMENTS_WITH_PRINT_LISTENERS.has(doc)) return;
  DOCUMENTS_WITH_PRINT_LISTENERS.add(doc);
  const view = doc.defaultView;
  view?.addEventListener("beforeprint", () => stampPrintMarker(doc));
  view?.addEventListener("afterprint", () => clearPrintMarker(doc));
}

/**
 * Prints through the browser dialog with the surface as the print target.
 * Returns false when no DOCX surface is mounted (nothing to print). The
 * marker is removed on afterprint, with a macrotask fallback for engines that
 * never fire it; the print snapshot is taken synchronously by print(), so the
 * fallback cannot leak chrome into the job.
 */
export function printDocxDocument(view: Window = window): boolean {
  const target = view.document;
  if (!target.querySelector(DOCX_PRINT_SURFACE_SELECTOR)) return false;
  installDocxPrintStyles(target);
  stampPrintMarker(target);
  const cleanup = () => clearPrintMarker(target);
  view.addEventListener("afterprint", cleanup, { once: true });
  try {
    view.print();
  } catch {
    // A host without a print implementation (embedded webviews, jsdom) must
    // not take the editor down; the caller reports the refusal.
    view.removeEventListener("afterprint", cleanup);
    cleanup();
    return false;
  }
  view.setTimeout(cleanup, 0);
  return true;
}
