import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { dispatchOfficeError } from "./error-state";

describe("office error dispatch", () => {
  it("maps conflicts, quota, incompatibility, and auth without parsing messages", () => {
    expect(dispatchOfficeError(new ApiError("irrelevant", "document_version_conflict", 409)).state).toBe("conflict");
    expect(dispatchOfficeError(new ApiError("irrelevant", "quota_exceeded", 403, "corr-quota", undefined, "quota"))).toMatchObject({
      state: "blocked",
      action: "keep_draft",
      correlationId: "corr-quota",
    });
    expect(dispatchOfficeError({ code: "engine_incompatible", error_class: "incompatible" })).toMatchObject({
      state: "incompatible",
      action: "read_only",
    });
    expect(dispatchOfficeError(new ApiError("irrelevant", "unauthorized", 401)).action).toBe("login");
  });

  it("keeps token-expired and draft-recovery-locked as client outcomes", () => {
    expect(dispatchOfficeError({ code: "token_expired", error_class: "session" })).toMatchObject({
      state: "blocked",
      action: "login",
    });
    expect(dispatchOfficeError({ code: "draft_recovery_locked" })).toMatchObject({
      state: "blocked",
      action: "keep_draft",
    });
  });

  it("fails safe for unknown code/class and retains the correlation id", () => {
    expect(dispatchOfficeError({ code: "future_error", error_class: "future_class", correlationId: "corr-future" })).toEqual({
      state: "error",
      code: "future_error",
      errorClass: "unknown",
      correlationId: "corr-future",
      retryable: false,
      ambiguous: false,
      action: "stop",
      message: "Office save could not be confirmed",
    });
  });
});

