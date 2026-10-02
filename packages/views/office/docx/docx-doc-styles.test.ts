// T (UNI-823 g3-04d): the surface must render the document's own typography.
// The vendored sheet paints the renderer defaults; this module generates the
// document rules from styles.xml + theme (docStyleCss / docThemeCss) and mounts
// them scoped to the surface root — upstream App.tsx:5583-5605 and
// file-actions.ts:372. The expected values below are the G3-D3 source-oracle
// values for the same fixture bytes (docx-kitchen-sink.docx, report
// reports/g3-d3-docx/metrics.json).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import {
  buildDocxDocumentStyleSheet,
  DOCX_DOC_STYLE_ELEMENT_ID,
  docxDocumentLang,
  installDocxDocumentStyles,
  scopeDocStyleSheet,
} from "./docx-doc-styles";

const KITCHEN_SINK_FIXTURE = resolve(
  __dirname,
  "../../../../docs/office/g0/fixtures/files/docs/docx-kitchen-sink.docx",
);

const readFixture = (path: string) => new Uint8Array(readFileSync(path));

describe("document style sheet (T)", () => {
  it("generates the oracle heading/paragraph declarations for the fixture", async () => {
    const parsed = await parseDocx(readFixture(KITCHEN_SINK_FIXTURE));
    const sheet = buildDocxDocumentStyleSheet(parsed);
    expect(sheet.length).toBeGreaterThan(0);
    // Scoped like the vendored renderer sheet, with no host-global rules.
    expect(sheet.startsWith("@scope (.docx-surface) {")).toBe(true);
    expect(sheet).not.toContain(":root");
    // h1: Heading1 style — 16pt / weight 600 (oracle: 21.3333px / 600)
    expect(sheet).toContain('.doc-page [data-style="Heading1"] { font-size:16pt;--doc-base-fs:16pt;font-weight:600 }');
    // h2: Heading2 — 14pt / weight 600 (oracle: 18.6667px / 600)
    expect(sheet).toContain('.doc-page [data-style="Heading2"] { font-size:14pt;--doc-base-fs:14pt;font-weight:600 }');
    // document baseline: space-after 8pt (160 twips) / 1.15 line spacing —
    // oracle marginBottom 10.6667px, line-height 18.7067px
    expect(sheet).toContain("margin-bottom:8.0pt");
    expect(sheet).toContain("--doc-line-mult:1.15");
    // the body font chain resolves from the document, not the app
    expect(sheet).toContain("font-family:'Calibri','Carlito GO'");
  });

  it("hoists @font-face blocks out of the surface scope", () => {
    const css = '@font-face { font-family:"X"; src:url(x) }\n.doc-page { color:#000 }';
    expect(scopeDocStyleSheet(css)).toBe(
      '@font-face { font-family:"X"; src:url(x) }\n@scope (.docx-surface) {\n.doc-page { color:#000 }\n}',
    );
    expect(scopeDocStyleSheet("")).toBe("");
  });

  it("mounts one style element per document, idempotently", async () => {
    const parsed = await parseDocx(readFixture(KITCHEN_SINK_FIXTURE));
    installDocxDocumentStyles(parsed);
    installDocxDocumentStyles(parsed);
    const styles = document.querySelectorAll(`#${DOCX_DOC_STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('data-style="Heading1"');
    // a parse without styles.xml (fake engines) writes no document rules
    document.getElementById(DOCX_DOC_STYLE_ELEMENT_ID)?.remove();
    installDocxDocumentStyles({ blocks: [{ type: "paragraph", docxIndex: 0 }] });
    expect(document.getElementById(DOCX_DOC_STYLE_ELEMENT_ID)?.textContent).toBe("");
  });

  it("applies the generated declarations as computed styles (jsdom cascade)", async () => {
    const parsed = await parseDocx(readFixture(KITCHEN_SINK_FIXTURE));
    const sheet = buildDocxDocumentStyleSheet(parsed);
    // jsdom has no @scope support; the scoping is pinned above, so the cascade
    // test runs the same generated rules unwrapped.
    const unwrapped = sheet.replace(/@scope \(\.docx-surface\) \{\n([\s\S]*)\n\}$/, "$1");
    expect(unwrapped).not.toContain("@scope");
    const host = document.createElement("div");
    host.className = "docx-surface";
    host.innerHTML =
      '<div class="doc-page"><h1 data-style="Heading1">Chapter</h1><h2 data-style="Heading2">Section</h2><p>Body</p></div>';
    const style = document.createElement("style");
    style.textContent = unwrapped;
    document.head.appendChild(style);
    document.body.appendChild(host);
    try {
      const h1 = host.querySelector("h1") as HTMLElement;
      const h2 = host.querySelector("h2") as HTMLElement;
      const p = host.querySelector("p") as HTMLElement;
      const h1Style = getComputedStyle(h1);
      // oracle h1: weight 600, marginTop 0px, marginBottom 10.6667px, size
      // 21.3333px — the sheet carries pt (8pt = 10.6667px, 16pt = 21.3333px)
      expect(h1Style.fontWeight).toBe("600");
      expect(h1Style.marginTop).toBe("0pt");
      expect(h1Style.marginBottom).toBe("8pt");
      expect(h1Style.fontSize).toBe("16pt");
      // oracle h2: weight 600, marginTop 0, bottom 10.6667px, size 18.6667px
      const h2Style = getComputedStyle(h2);
      expect(h2Style.fontWeight).toBe("600");
      expect(h2Style.marginTop).toBe("0pt");
      expect(h2Style.marginBottom).toBe("8pt");
      // body paragraphs take the document baseline (space-after 8pt)
      const pStyle = getComputedStyle(p);
      expect(pStyle.marginTop).toBe("0pt");
      expect(pStyle.marginBottom).toBe("8pt");
    } finally {
      host.remove();
      style.remove();
    }
  });

  it("carries the document language only for autoHyphenation documents", () => {
    expect(docxDocumentLang({ autoHyphenation: true, docDefaults: { lang: "vi-VN" } })).toBe("vi-VN");
    expect(docxDocumentLang({ autoHyphenation: false, docDefaults: { lang: "vi-VN" } })).toBeNull();
    expect(docxDocumentLang({ autoHyphenation: true, docDefaults: {} })).toBeNull();
  });
});
