import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { toastCreateTaskError } from "./create-task-error-toast";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const copy = {
  fallback: "Không tạo được",
  duplicateTitle: "Đã có task đang mở",
  viewExisting: "Xem task",
  quotaExceeded: "Hết hạn mức task",
  quotaContactAdmin: "Liên hệ quản trị",
  viewBilling: "Xem gói",
  inFlight: "Đang xử lý",
};

describe("toastCreateTaskError", () => {
  it("offers view-existing for active_duplicate_task and keeps structured fields", () => {
    toastError.mockReset();
    const onViewTask = vi.fn();
    toastCreateTaskError(
      new ApiError("trùng", "active_duplicate_task", 409, undefined, {
        task_id: "t9",
        identifier: "UNI-9",
        title: "Login bug",
      }),
      copy,
      { onViewTask },
    );
    expect(toastError).toHaveBeenCalledWith(
      copy.duplicateTitle,
      expect.objectContaining({
        description: "UNI-9 – Login bug",
        action: expect.objectContaining({ label: copy.viewExisting }),
      }),
    );
    const opts = toastError.mock.calls[0]?.[1] as { action?: { onClick: () => void } };
    opts.action?.onClick();
    expect(onViewTask).toHaveBeenCalledWith("t9");
  });

  it("offers billing when quota is exceeded and the caller may view billing", () => {
    toastError.mockReset();
    const onViewBilling = vi.fn();
    toastCreateTaskError(new ApiError("hết", "quota_exceeded", 403), copy, {
      canViewBilling: true,
      onViewBilling,
    });
    expect(toastError).toHaveBeenCalledWith(
      copy.quotaExceeded,
      expect.objectContaining({
        action: expect.objectContaining({ label: copy.viewBilling }),
      }),
    );
  });

  it("explains who to ask when quota is exceeded without billing access", () => {
    toastError.mockReset();
    toastCreateTaskError(new ApiError("hết", "quota_exceeded", 403), copy, {
      canViewBilling: false,
    });
    expect(toastError).toHaveBeenCalledWith(
      copy.quotaExceeded,
      expect.objectContaining({ description: copy.quotaContactAdmin }),
    );
  });

  it("uses the in-flight sentence for idempotency_in_flight", () => {
    toastError.mockReset();
    toastCreateTaskError(new ApiError("busy", "idempotency_in_flight", 409), copy);
    expect(toastError).toHaveBeenCalledWith(copy.inFlight);
  });
});
