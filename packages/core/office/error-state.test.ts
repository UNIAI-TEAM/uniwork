import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import { dispatchOfficeError } from "./error-state";

describe("office error dispatch", () => {
  it("reconciles actual DOMException and named Error cancellations", () => {
    const dom = new DOMException("cancelled", "AbortError");
    expect(dom).not.toBeInstanceOf(Error);
    const named = Object.assign(new Error("cancelled"), { name: "AbortError" });
    for (const error of [dom, named]) {
      expect(dispatchOfficeError(error)).toMatchObject({
        code: "request_aborted", action: "reconcile", ambiguous: true, retryable: false,
      });
    }
  });

  it("denies non-Abort DOMExceptions, spoofed names and unknown errors", () => {
    for (const error of [new DOMException("denied", "SecurityError"), { name: "AbortError" }, new Error("unknown")]) {
      expect(dispatchOfficeError(error)).toMatchObject({
        code: "office_unknown_error", action: "stop", ambiguous: false, retryable: false,
      });
    }
  });

  it("keeps explicit string codes ahead of the cancellation fallback", () => {
    const dom = Object.assign(new DOMException("cancelled", "AbortError"), { error_code: "future_error" });
    const named = Object.assign(new Error("cancelled"), { name: "AbortError", code: "forbidden" });
    expect(dispatchOfficeError(dom)).toMatchObject({ code: "future_error", action: "stop", ambiguous: false });
    expect(dispatchOfficeError(named)).toMatchObject({ code: "forbidden", action: "keep_draft", ambiguous: false });
    expect(dispatchOfficeError({ code: "forbidden", error_code: "engine_timeout" }).code).toBe("forbidden");
  });

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

  it("falls back to the 401 baseline when a bodiless answer lost its code", () => {
    expect(dispatchOfficeError({ status: 401 })).toMatchObject({ state: "blocked", action: "login" });
    expect(dispatchOfficeError(new ApiError("irrelevant", "internal", 401))).toMatchObject({ state: "blocked", action: "login" });
  });

  it("maps upload checksum failures to reconcile and keeps pipeline guard codes typed", () => {
    expect(dispatchOfficeError({ code: "upload_checksum_mismatch", error_class: "conflict", status: 409 })).toMatchObject({
      state: "error",
      action: "reconcile",
      retryable: false,
    });
    expect(dispatchOfficeError({ code: "malformed_commit_receipt" })).toMatchObject({
      state: "error",
      action: "reconcile",
      retryable: true,
      ambiguous: true,
    });
    expect(dispatchOfficeError({ code: "malformed_serialized_output" })).toMatchObject({ state: "error", action: "retry", ambiguous: false });
    expect(dispatchOfficeError({ code: "stale_generation" })).toMatchObject({ state: "error", action: "keep_draft" });
  });

  it("keeps a dropped-rule-set save refusal non-terminal and not automatically retried", () => {
    expect(dispatchOfficeError({ code: "xlsx_rule_sets_dropped", errorClass: "engine" })).toMatchObject({ state: "error", action: "retry", retryable: false, ambiguous: false });
  });

  it.each([
    ["file_locked", "retry", true],
    ["file_write_failed", "retry", true],
    ["file_replace_failed", "retry", true],
    ["file_save_in_progress", "retry", true],
    ["file_checkpoint_failed", "retry", true],
    ["file_save_too_large", "keep_draft", false],
    ["file_changed_on_disk", "keep_draft", false],
    ["file_not_found", "keep_draft", false],
    ["file_session_revoked", "keep_draft", false],
    ["file_access_denied", "stop", false],
    ["file_invalid_path", "stop", false],
    ["file_handle_invalid", "stop", false],
    ["file_engine_unavailable", "stop", false],
    ["file_failed", "stop", false],
    ["file_read_failed", "stop", false],
  ] as const)("keeps %s on the error state with %s so the banner shows its reason", (code, action, retryable) => {
    expect(dispatchOfficeError({ code })).toMatchObject({ state: "error", action, retryable, ambiguous: false });
  });
});
