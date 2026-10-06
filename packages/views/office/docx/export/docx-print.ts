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
/** UNI-957: the one surface that prints; other DOCX documents mounted in the
 *  same page (hidden desktop tabs) stay out of the job. */
export const DOCX_PRINT_TARGET_ATTRIBUTE = "data-docx-print-target";
const DOCX_PRINT_TARGET_SELECTOR = `${DOCX_PRINT_SURFACE_SELECTOR}[${DOCX_PRINT_TARGET_ATTRIBUTE}]`;

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
    `  ${marker} ${DOCX_PRINT_TARGET_SELECTOR} {`,
    "    position: absolute !important;",
    "    inset: 0 auto auto 0 !important;",
    "    width: 100% !important;",
    "    padding: 0 !important;",
    "  }",
    `  ${marker} * {`,
    "    visibility: hidden !important;",
    "  }",
    `  ${marker} ${DOCX_PRINT_TARGET_SELECTOR},`,
    `  ${marker} ${DOCX_PRINT_TARGET_SELECTOR} * {`,
    "    visibility: visible !important;",
    "  }",
    "}",
    "",
  ].join("\n");
}

const DOCUMENTS_WITH_PRINT_LISTENERS = new WeakSet<Document>();

/** The surface a native Ctrl+P prints: the first one not inside a hidden
 *  ancestor, so a DOCX kept mounted in a hidden desktop tab never blanks the
 *  visible document's print. */
function visibleSurface(target: Document): Element | null {
  return [...target.querySelectorAll(DOCX_PRINT_SURFACE_SELECTOR)].find((surface) => !surface.closest("[hidden]")) ?? null;
}

function stampPrintMarker(target: Document, surface: Element | null = visibleSurface(target)): void {
  if (!target.body || !surface) return;
  surface.setAttribute(DOCX_PRINT_TARGET_ATTRIBUTE, "");
  target.body.setAttribute(DOCX_PRINT_ATTRIBUTE, "");
}

function clearPrintMarker(target: Document): void {
  target.body?.removeAttribute(DOCX_PRINT_ATTRIBUTE);
  for (const surface of target.querySelectorAll(`[${DOCX_PRINT_TARGET_ATTRIBUTE}]`)) surface.removeAttribute(DOCX_PRINT_TARGET_ATTRIBUTE);
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
export function printDocxDocument(view: Window = window, scope: ParentNode = view.document): boolean {
  const target = view.document;
  // The caller's own document (UNI-957); without one, the visible surface a
  // native print would pick.
  const surface = scope === target ? visibleSurface(target) : scope.querySelector(DOCX_PRINT_SURFACE_SELECTOR);
  if (!surface) return false;
  installDocxPrintStyles(target);
  stampPrintMarker(target, surface);
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
