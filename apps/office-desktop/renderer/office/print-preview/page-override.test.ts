// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { withChosenSheet } from "./page-override";

const a4 = { landscape: false, pageSize: { width: 210_000, height: 297_000 } };
const copy = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="style-src 'unsafe-inline'"><style>@page sec1{size:210mm 297mm}</style><title>Doc</title></head><body><p>x</p></body></html>`;

describe("withChosenSheet", () => {
  it("leaves the copy untouched on the document's own sheet", () => {
    expect(withChosenSheet(copy, a4, a4)).toBe(copy);
  });

  it("appends one rule last in the head that puts every page on the chosen sheet", () => {
    const out = withChosenSheet(copy, { ...a4, landscape: true }, a4);
    const doc = new DOMParser().parseFromString(out, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style"));
    expect(styles.at(-1)?.hasAttribute("data-print-sheet")).toBe(true);
    expect(styles.at(-1)?.textContent).toContain("@page{size:297mm 210mm}");
    expect(styles.at(-1)?.textContent).toContain("@page :first{size:297mm 210mm}");
    expect(styles.at(-1)?.textContent).toContain("page:auto!important");
    expect(doc.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(doc.body.textContent).toBe("x");
  });

  it("lays a changed paper out portrait short side first", () => {
    const out = withChosenSheet(copy, { landscape: false, pageSize: { width: 297_000, height: 420_000 } }, a4);
    expect(out).toContain("@page{size:297mm 420mm}");
  });
});
