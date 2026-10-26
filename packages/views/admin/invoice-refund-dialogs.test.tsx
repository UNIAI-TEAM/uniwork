/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { AdminInvoiceRefundDialogs } from "./invoice-refund-dialogs";

const mutateAsync = vi.fn();
const invalidateQueries = vi.fn().mockResolvedValue(undefined);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@uniwork/core/admin", () => ({
  adminKeys: { invoicesRoot: ["admin", "invoices"] },
  useAdminRefundInvoice: () => ({ isPending: false, mutateAsync }),
  useAdminConfirmInvoiceRefund: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

const target = {
  id: "inv1",
  number: "UW-001",
  amount_paid: 499_000,
  amount_refunded: 0,
  currency: "VND",
};

describe("AdminInvoiceRefundDialogs", () => {
  it("shows an error and keeps the dialog open when the server answers invoice_not_refundable", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError("conflict", "invoice_not_refundable", 409));
    const onRefundTargetChange = vi.fn();
    toastSuccess.mockClear();
    toastError.mockClear();

    render(
      <AdminInvoiceRefundDialogs
        refundTarget={target}
        onRefundTargetChange={onRefundTargetChange}
        confirmTarget={null}
        onConfirmTargetChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "ly do hoan tien du 10 ky tu" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Hóa đơn không ở trạng thái cho phép hoàn.");
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onRefundTargetChange).not.toHaveBeenCalledWith(null);
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("still treats vnpay_refund_pending as a successful refund request", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError("pending", "vnpay_refund_pending", 409));
    const onRefundTargetChange = vi.fn();
    toastSuccess.mockClear();
    toastError.mockClear();

    render(
      <AdminInvoiceRefundDialogs
        refundTarget={target}
        onRefundTargetChange={onRefundTargetChange}
        confirmTarget={null}
        onConfirmTargetChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "ly do hoan tien du 10 ky tu" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(onRefundTargetChange).toHaveBeenCalledWith(null);
  });
});
