import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema, markdownUrlTransform } from "./sanitize";

/**
 * Markdown here is rendered with `rehype-raw`, which means user-authored HTML
 * reaches the DOM. These two exports are the whole defence, and they are the
 * only part of the ported renderer whose failure is a security bug rather than
 * a layout one — so they get the test the upstream registry never had.
 */
describe("markdown sanitize schema", () => {
  it("does not whitelist script or style tags", () => {
    const tags = markdownSanitizeSchema.tagNames ?? [];
    expect(tags).not.toContain("script");
    expect(tags).not.toContain("style");
    expect(tags).not.toContain("iframe");
  });

  it("keeps the mark tag the highlight syntax emits", () => {
    expect(markdownSanitizeSchema.tagNames).toContain("mark");
  });

  it("restricts href to schemes that cannot execute", () => {
    const href = markdownSanitizeSchema.protocols?.href ?? [];
    expect(href).not.toContain("javascript");
    expect(href).toContain("http");
    expect(href).toContain("https");
  });
});

describe("markdown url transform", () => {
  it("blanks a javascript: url", () => {
    // The last thing standing between a pasted link and script execution.
    expect(markdownUrlTransform("javascript:alert(1)")).toBe("");
  });

  it("blanks a non-image data: url", () => {
    // The schema lets `data:` through for src so inline images work; this gate
    // is what stops `data:text/html` riding in on the same allowance.
    expect(markdownUrlTransform("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
  });

  it("keeps inline images, ordinary links and the mention scheme intact", () => {
    expect(markdownUrlTransform("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(markdownUrlTransform("https://uniwork.app/x")).toBe(
      "https://uniwork.app/x",
    );
    expect(markdownUrlTransform("mention://user/42")).toBe("mention://user/42");
  });
});
