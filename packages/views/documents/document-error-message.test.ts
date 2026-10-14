import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import { documentErrorMessage } from "./document-error-message";

type T = Parameters<typeof documentErrorMessage>[1];

function fakeT() {
  return vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key,
  ) as unknown as T & ReturnType<typeof vi.fn>;
}

describe("documentErrorMessage", () => {
  it("maps folder_name_taken to its own sentence", () => {
    const t = fakeT();
    const msg = documentErrorMessage(new ApiError("taken", "folder_name_taken", 409), t, "fallback");
    expect(msg.split("|")[0]).toBe("documents.errors.folder_name_taken");
  });

  it("passes the shared depth limit to the too-deep sentence", () => {
    const t = fakeT();
    documentErrorMessage(new ApiError("deep", "document_too_deep", 422), t, "fallback");
    expect(t).toHaveBeenCalledWith("documents.errors.document_too_deep", { max: TREE_MAX_LEVEL });
  });

  it("keeps the server message for an uncoded failure, then the fallback", () => {
    const t = fakeT();
    expect(documentErrorMessage(new ApiError("Nope", "something_else", 400), t, "fallback")).toBe("Nope");
    expect(documentErrorMessage(undefined, t, "fallback")).toBe("fallback");
  });
});
