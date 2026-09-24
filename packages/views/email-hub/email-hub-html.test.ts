import { describe, expect, it } from "vitest";
import { EMAIL_HTML_RESET, wrapEmailHtml } from "./email-hub-html";

describe("email hub html wrapper", () => {
  it("does not force layout tables to full width", () => {
    expect(EMAIL_HTML_RESET).not.toMatch(/table\s*\{[^}]*width\s*:\s*100%/i);
    expect(EMAIL_HTML_RESET).not.toContain("table-layout:fixed");
  });

  it("injects reset styles into html documents", () => {
    const wrapped = wrapEmailHtml('<html><head></head><body><table width="600"><tr><td>Hi</td></tr></table></body></html>');
    expect(wrapped).toContain('width="600"');
    expect(wrapped).toContain("uniwork-email-reset");
  });

  it("keeps table headers on one line", () => {
    expect(EMAIL_HTML_RESET).toContain("white-space:nowrap");
    expect(EMAIL_HTML_RESET).not.toContain("overflow-wrap:anywhere");
  });
});
