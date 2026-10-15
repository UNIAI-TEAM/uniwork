import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminPlansView } from "./plans";

const { createPlan } = vi.hoisted(() => ({
  createPlan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@uniwork/core/admin", () => ({
  useAdminPlans: () => ({
    isPending: false,
    isError: false,
    data: [
      {
        id: "p1",
        code: "starter",
        name: "Starter",
        description: "Default",
        billing_period: "none",
        price_amount: 0,
        price_currency: "VND",
        is_default: true,
        is_active: true,
        sort_order: 0,
        features: [{ feature_key: "members.max", name: "Members", kind: "quota", enabled: true, quota_limit: 5 }],
      },
    ],
    refetch: vi.fn(),
  }),
  useCreateAdminPlan: () => ({ isPending: false, mutateAsync: createPlan }),
  useUpdateAdminPlan: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateAdminPlanFeature: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

describe("AdminPlansView", () => {
  it("renders plan catalog rows", () => {
    render(<AdminPlansView />);
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getByText("members.max")).toBeInTheDocument();
  });

  it("sends the billing period chosen in the select", () => {
    createPlan.mockClear();
    render(<AdminPlansView />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm gói" }));
    fireEvent.change(screen.getByLabelText("Mã gói (vd. enterprise)"), { target: { value: "goi-nam" } });
    fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "Gói năm" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Chu kỳ (none / month / year)" }));
    const year = screen.getByRole("option", { name: "Năm" });
    fireEvent.pointerDown(year, { pointerType: "mouse" });
    fireEvent.pointerUp(year, { pointerType: "mouse" });
    fireEvent.click(year);
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "tao goi nam cho khach" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "goi-nam",
        billing_period: "year",
        reason: "tao goi nam cho khach",
      }),
    );
  });
});
