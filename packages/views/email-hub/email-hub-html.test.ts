import { describe, expect, it } from "vitest";
import { EMAIL_HTML_RESET, emailHasRemoteContent, wrapEmailHtml } from "./email-hub-html";

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

  it("renders the body on its own light page with a sans-serif face and padding", () => {
    expect(EMAIL_HTML_RESET).toMatch(/html\{background:#ffffff/);
    expect(EMAIL_HTML_RESET).toContain("color-scheme");
    expect(EMAIL_HTML_RESET).toMatch(/body\{[^}]*padding:20px/);
    expect(EMAIL_HTML_RESET).toMatch(/body\{[^}]*font-family:Inter/);
    expect(EMAIL_HTML_RESET).not.toContain("color:inherit");
  });

  it("keeps table headers on one line", () => {
    expect(EMAIL_HTML_RESET).toContain("white-space:nowrap");
    expect(EMAIL_HTML_RESET).not.toContain("overflow-wrap:anywhere");
  });

  it("blocks remote images unless the reader allowed them", () => {
    const html = '<p>Hi</p><img src="https://track.example.com/p.gif">';
    expect(wrapEmailHtml(html)).toContain("Content-Security-Policy");
    expect(wrapEmailHtml(html)).toMatch(/img-src data: cid:/);
    expect(wrapEmailHtml(html, { allowRemote: true })).not.toContain("Content-Security-Policy");
  });

  it("puts the policy before the email's own head content", () => {
    const wrapped = wrapEmailHtml('<html><head><link rel="stylesheet" href="https://x.com/a.css"></head><body></body></html>');
    expect(wrapped.indexOf("Content-Security-Policy")).toBeLessThan(wrapped.indexOf("x.com/a.css"));
  });

  it("puts the policy in the real head even when the body quotes a whole document", () => {
    const html =
      '<div>reply <img src="https://track.example.com/p.gif"></div><blockquote><html><head><title>q</title></head><body>old</body></html></blockquote>';
    const doc = new DOMParser().parseFromString(wrapEmailHtml(html), "text/html");
    expect(doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
  });

  it("is not fooled by a commented head or a header element", () => {
    for (const html of [
      "<!--<head>--><html><head></head><body><img src='https://t.example/p.gif'></body></html>",
      "<html><body><header>Hi</header><head></head></body></html>",
    ]) {
      const doc = new DOMParser().parseFromString(wrapEmailHtml(html), "text/html");
      expect(doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    }
  });

  it("keeps the email's doctype first", () => {
    const wrapped = wrapEmailHtml('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"><html><head></head><body></body></html>');
    expect(wrapped.startsWith("<!DOCTYPE html PUBLIC")).toBe(true);
    expect(wrapped).toContain("Content-Security-Policy");
  });

  it("detects remote srcset, poster and @import, but not data-src", () => {
    expect(emailHasRemoteContent('<picture><source srcset="https://a.com/x.webp 1x"></picture>')).toBe(true);
    expect(emailHasRemoteContent('<img srcset="https://a.com/x.png 2x" src="data:image/png;base64,AA">')).toBe(true);
    expect(emailHasRemoteContent('<video poster="https://a.com/p.jpg"></video>')).toBe(true);
    expect(emailHasRemoteContent('<style>@import "https://a.com/a.css";</style>')).toBe(true);
    expect(emailHasRemoteContent('<img data-src="https://a.com/x.png" src="cid:abc">')).toBe(false);
  });

  it("detects remote images, backgrounds and stylesheets", () => {
    expect(emailHasRemoteContent('<img src="https://a.com/x.png">')).toBe(true);
    expect(emailHasRemoteContent("<img src='//a.com/x.png'>")).toBe(true);
    expect(emailHasRemoteContent('<td style="background:url(https://a.com/b.png)">')).toBe(true);
    expect(emailHasRemoteContent('<td background="http://a.com/b.png">')).toBe(true);
    expect(emailHasRemoteContent('<img src="data:image/png;base64,AAA"><a href="https://a.com">x</a>')).toBe(false);
  });
});
