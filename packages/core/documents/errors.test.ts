import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import {
  classifyDocumentError,
  isDocumentNotInTrashError,
  isDocumentShelvedError,
  isFolderTooLargeError,
  shareLevelNotAllowedMax,
} from "./errors";

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

  it("classifies workspace_seat_required as a permission from the code alone", () => {
    // BE-12-302: a copy into a workspace the person holds no seat in answers
    // 403 workspace_seat_required. The status here is one the fallback does not
    // classify (422), so only the code entry can place it, pinning the mirror
    // of errorClassByCode rather than the 403 status.
    const err = new ApiError("bạn cần là thành viên của không gian làm việc này để tạo bản sao ở đó", "workspace_seat_required", 422);
    expect(classifyDocumentError(err)).toEqual({ cls: "permission", code: "workspace_seat_required", fields: undefined });
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

  it("reads the home-row ceiling of a level_not_allowed refusal", () => {
    // SH-S1 Q-S1: the code carries no error_class on purpose (it is neither a
    // lost permission nor a reload), so fields.max is the client's whole
    // reading of the refusal, and never a level the code does not name.
    const refused = new ApiError("dòng Workspace gốc chỉ nhận view, comment hoặc edit", "level_not_allowed", 422, undefined, {
      max: "edit",
    });
    expect(shareLevelNotAllowedMax(refused)).toBe("edit");
    expect(shareLevelNotAllowedMax(new ApiError("x", "level_not_allowed", 422))).toBeNull();
    expect(shareLevelNotAllowedMax(new ApiError("x", "level_not_allowed", 422, undefined, { max: "owner" }))).toBeNull();
    expect(shareLevelNotAllowedMax(new ApiError("x", "break_glass_required", 403))).toBeNull();
  });

  it("classifies my_folder_locked as a conflict from the code alone", () => {
    const err = new ApiError("không thể thay đổi Thư mục của tôi", "my_folder_locked", 422);
    expect(classifyDocumentError(err)).toEqual({
      cls: "conflict",
      code: "my_folder_locked",
      fields: undefined,
    });
  });

  it("keeps document_not_in_trash and folder_too_large unclassified while matching their helpers", () => {
    // RESTORE-01 (UNI-1843): neither a live-document purge refusal (400
    // document_not_in_trash) nor a subtree node-cap refusal (400/422
    // folder_too_large) is a save conflict, usage quota or lost permission.
    const notInTrash = new ApiError("tài liệu không nằm trong thùng rác", "document_not_in_trash", 400);
    const tooLarge400 = new ApiError("thư mục quá lớn", "folder_too_large", 400);
    const tooLarge422 = new ApiError("thư mục quá lớn", "folder_too_large", 422);

    expect(classifyDocumentError(notInTrash)).toEqual({
      cls: "unknown",
      code: "document_not_in_trash",
      fields: undefined,
    });
    expect(classifyDocumentError(tooLarge400)).toEqual({
      cls: "unknown",
      code: "folder_too_large",
      fields: undefined,
    });
    expect(classifyDocumentError(tooLarge422)).toEqual({
      cls: "unknown",
      code: "folder_too_large",
      fields: undefined,
    });

    expect(isDocumentNotInTrashError(notInTrash)).toBe(true);
    expect(isDocumentNotInTrashError(tooLarge400)).toBe(false);
    expect(isDocumentNotInTrashError(new Error("document_not_in_trash"))).toBe(false);

    expect(isFolderTooLargeError(tooLarge400)).toBe(true);
    expect(isFolderTooLargeError(tooLarge422)).toBe(true);
    expect(isFolderTooLargeError(notInTrash)).toBe(false);
    expect(isFolderTooLargeError(null)).toBe(false);
  });

  it("classifies document_shelved as read_only from the code alone (ARCHIVE-01)", () => {
    // ARCHIVE-01 §0/§3: every write on a shelved document answers 409
    // document_shelved, stamped read_only. A 422 code path proves the entry
    // comes from the code map, not the status fallback (bare 422 stays
    // unknown) - and a bare 409 would otherwise read as a save-conflict.
    const err = new ApiError("tài liệu đã được lưu trữ", "document_shelved", 422);
    expect(classifyDocumentError(err)).toEqual({ cls: "read_only", code: "document_shelved", fields: undefined });
  });

  it("keeps the server's read_only stamp when it declares one", () => {
    const err = new ApiError("tài liệu đã được lưu trữ", "document_shelved", 409, "corr", undefined, "read_only");
    expect(classifyDocumentError(err)).toEqual({ cls: "read_only", code: "document_shelved", fields: undefined });
    expect(isDocumentShelvedError(err)).toBe(true);
    expect(isDocumentShelvedError(new ApiError("x", "document_archived", 403))).toBe(false);
    expect(isDocumentShelvedError(new Error("network"))).toBe(false);
  });
});

