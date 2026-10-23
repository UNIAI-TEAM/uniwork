import { describe, expect, it } from "vitest";
import { isParentWorkspaceShared, quickCreateTypes } from "./documents-create";

describe("isParentWorkspaceShared", () => {
  it("is false under a folder, even a legacy one that still says workspace (UNI-1974)", () => {
    expect(isParentWorkspaceShared({ kind: "folder", visibility: "workspace" })).toBe(false);
    expect(
      isParentWorkspaceShared({ kind: "folder", share_scope: { home_workspace: true } }),
    ).toBe(false);
  });

  it("still follows a page parent", () => {
    expect(isParentWorkspaceShared({ kind: "page", visibility: "workspace" })).toBe(true);
    expect(isParentWorkspaceShared({ kind: "page", visibility: "restricted" })).toBe(false);
  });
});

describe("quickCreateTypes", () => {
  const FOUR = ["page", "docx", "xlsx", "pptx"];

  it("is UniNote, DOCX, XLSX and PPTX when nothing was created yet", () => {
    expect(quickCreateTypes(null)).toEqual(FOUR);
    expect(quickCreateTypes(undefined)).toEqual(FOUR);
  });

  it("appends the type created last when it is not one of the four", () => {
    expect(quickCreateTypes("md")).toEqual([...FOUR, "md"]);
    expect(quickCreateTypes("html")).toEqual([...FOUR, "html"]);
    expect(quickCreateTypes("pdf")).toEqual([...FOUR, "pdf"]);
  });

  it("adds nothing when the last type is already one of the four", () => {
    for (const type of FOUR) expect(quickCreateTypes(type as "page")).toEqual(FOUR);
  });

  it("never adds Plain text: it has no chip and lives only in the New menu", () => {
    expect(quickCreateTypes("txt")).toEqual(FOUR);
  });
});
