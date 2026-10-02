"use client";

// G3-04d T (UNI-823): the document's own typography.
//
// The vendored renderer sheet paints the surface defaults (Calibri stack, the
// sheet's own heading sizes/margins); the document's real styles live in
// styles.xml + theme and are generated per open — upstream genoffice does this
// in file-actions (`setDocCss(docStyleCss(parsed))`) and renders the theme
// rules from live state (`docThemeCss`). UniWork is the App here, so this
// module builds one document style sheet from the parse and mounts it beside
// the renderer sheet. Display-only: the save path never touches styles.xml.
import {
  docBodyFont,
  docStyleCss,
  docThemeCss,
  type RendererParsed,
} from "@uniwork/office-upstream/docs-renderer-editor";

export const DOCX_DOC_STYLE_ELEMENT_ID = "uniwork-docx-document-styles";

// The generator emits top-level rules plus @font-face (the typed-grid strut
// alias) and one @media screen block (dark twins). A face is document-global
// by nature, so it is hoisted out of the scope rather than swallowed by it.
const FONT_FACE_RE = /@font-face\s*\{[^{}]*\}/g;

/**
 * Scope the generated document sheet to `.docx-surface`, the same root the
 * vendored renderer sheet is repackaged under (`scripts/office/
 * docx-renderer-styles.mjs`), so document rules cannot leak into the app
 * shell. `@font-face` blocks stay global.
 */
export function scopeDocStyleSheet(css: string): string {
  const faces: string[] = [];
  const rest = css.replace(FONT_FACE_RE, (face) => {
    faces.push(face);
    return "";
  });
  const parts = [...faces];
  const body = rest.trim();
  if (body) parts.push(`@scope (.docx-surface) {\n${body}\n}`);
  return parts.join("\n");
}

/** The complete document sheet for one parse: styles.xml, theme, live rules. */
export function buildDocxDocumentStyleSheet(parsed: unknown): string {
  // The generator reads styles.xml; a parse that carries none (fake engines,
  // blank documents) has no document rules to emit and keeps the sheet defaults.
  if (!((parsed as { styles?: unknown }).styles instanceof Map)) return "";
  const doc = parsed as RendererParsed;
  const theme = parsed as { themeFonts?: unknown; themeColors?: unknown };
  const parts = [
    docStyleCss(doc),
    docThemeCss(theme.themeFonts ?? null, theme.themeColors ?? null, !!docBodyFont(doc)),
  ].filter((part) => part.trim().length > 0);
  return scopeDocStyleSheet(parts.join("\n"));
}

/**
 * Mount/refresh the document style sheet (idempotent per document, like
 * `installDocxRendererStyles`). The sheet is replaced on every open, so one
 * element always carries the current document's styles.
 */
export function installDocxDocumentStyles(parsed: unknown, target: Document = document): void {
  let style = target.getElementById(DOCX_DOC_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = target.createElement("style");
    style.id = DOCX_DOC_STYLE_ELEMENT_ID;
    style.dataset.uniworkDocxDocumentStyles = "1";
    target.head.appendChild(style);
  }
  style.textContent = buildDocxDocumentStyleSheet(parsed);
}

/**
 * The document language Chromium hyphenates under (upstream
 * `applyDocLayoutSettings`): only autoHyphenation documents carry it, so CJK
 * fallback elsewhere is untouched. null when the document declares none.
 */
export function docxDocumentLang(parsed: unknown): string | null {
  const doc = parsed as { autoHyphenation?: unknown; docDefaults?: { lang?: unknown } };
  if (doc.autoHyphenation !== true) return null;
  const lang = doc.docDefaults?.lang;
  return typeof lang === "string" && lang.length > 0 ? lang : null;
}
