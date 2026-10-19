import { describe, expect, it } from "vitest";
import { isParentWorkspaceShared } from "./documents-create";

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
