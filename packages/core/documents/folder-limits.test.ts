import { describe, expect, it } from "vitest";
import { DOCUMENT_TITLE_MAX, FOLDER_TITLE_MAX, TREE_MAX_LEVEL } from "./folder-limits";

// Pinned to the folders contract v1.0 (docs/superpowers/specs/
// 2026-10-13-documents-folders-addendum.md §4): FD-D2 depth and the FD-D3
// title caps. The server constant `maxDocumentDepth` lands with FD-03; when
// it merges, re-prove this value against it rather than editing the number.
describe("folder limits", () => {
  it("matches the signed tree depth (FD-D2)", () => {
    expect(TREE_MAX_LEVEL).toBe(20);
  });

  it("matches the signed title caps (FD-D3)", () => {
    expect(FOLDER_TITLE_MAX).toBe(255);
    expect(DOCUMENT_TITLE_MAX).toBe(500);
  });
});
