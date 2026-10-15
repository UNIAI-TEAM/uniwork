import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { classifyDocumentError, isConflictClass } from "./errors";

// classifyDocumentError reads the server's error_class stamp first, then the
// stable code, then the status. CODE_TO_CLASS mirrors errorClassByCode in
// server/internal/handler/dto/sdo/error_class.go, so every documents code the
// server classifies must classify the same way here when the stamp is absent -
// a proxy, an older server or a stripped envelope.

describe("classifyDocumentError", () => {
  it("classifies folder_name_taken as a conflict from the code alone", () => {
    // E6 FD-02: a folder create or rename asked for a name a live sibling
    // holds (409 folder_name_taken). The status here is one the fallback
    // deliberately does not classify (422 spans conflicts AND validation
    // failures), so only the code entry can place it - which is what pins the
    // mirror rather than the status.
    const err = new ApiError("thư mục đã có tên này trong cùng thư mục cha", "folder_name_taken", 422);
    expect(classifyDocumentError(err)).toEqual({ cls: "conflict", code: "folder_name_taken", fields: undefined });
  });

  it("keeps folder_name_taken a conflict on its real 409 envelope", () => {
    const err = new ApiError("thư mục đã có tên này trong cùng thư mục cha", "folder_name_taken", 409);
    expect(classifyDocumentError(err)).toEqual({ cls: "conflict", code: "folder_name_taken", fields: undefined });
  });

  it("prefers the server's declared class over the code", () => {
    // The mirror never overrides a stamp: a code whose class the server
    // changed must follow the server, not this table.
    const err = new ApiError("x", "folder_name_taken", 409, undefined, undefined, "permission");
    expect(classifyDocumentError(err).cls).toBe("permission");
  });

  it("leaves an unlisted code with an unclassifiable status unknown", () => {
    const err = new ApiError("x", "no_such_documents_code", 422);
    expect(classifyDocumentError(err).cls).toBe("unknown");
  });

  // UNI-1645: the server stamps no class on 423 document_locked; the code
  // alone places it in the client-only "locked" class, never a conflict.
  it("classifies document_locked as locked, not a conflict", () => {
    const fields = { holder_id: "u2", holder_name: "Bình", held_by_me: false, current_revision: "42" };
    const err = new ApiError("đang có người sửa", "document_locked", 423, undefined, fields);
    const out = classifyDocumentError(err);
    expect(out).toEqual({ cls: "locked", code: "document_locked", fields });
    expect(isConflictClass(out.cls)).toBe(false);
  });
});
