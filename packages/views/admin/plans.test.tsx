import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { AdminPlansView } from "./plans";

const { createPlan, updatePlan, updateFeature } = vi.hoisted(() => ({
  createPlan: vi.fn().mockResolvedValue(undefined),
  updatePlan: vi.fn().mockResolvedValue(undefined),
  updateFeature: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
        features: [{ feature_key: "members.max", name: "Members", kind: "quota", enabled: true, quota_limit: 5, unit: "" }],
      },
      {
        id: "p2",
        code: "team",
        name: "Team",
        description: "Paid",
        billing_period: "month",
        price_amount: 499000,
        price_currency: "VND",
        is_default: false,
        is_active: true,
        sort_order: 10,
        features: [
          { feature_key: "members.max", name: "Members", kind: "quota", enabled: true, quota_limit: 50, unit: "" },
          { feature_key: "storage.bytes", name: "Storage", kind: "quota", enabled: true, quota_limit: null, unit: "bytes" },
        ],
      },
    ],
    refetch: vi.fn(),
  }),
  useCreateAdminPlan: () => ({ isPending: false, mutateAsync: createPlan }),
  useUpdateAdminPlan: () => ({ isPending: false, mutateAsync: updatePlan }),
  useUpdateAdminPlanFeature: () => ({ isPending: false, mutateAsync: updateFeature }),
}));

function openCreate(price: string) {
  fireEvent.click(screen.getByRole("button", { name: "Thêm gói" }));
  fireEvent.change(screen.getByLabelText("Mã gói (vd. enterprise)"), { target: { value: "goi-moi" } });
  fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "Gói mới" } });
  fireEvent.change(screen.getByLabelText("Giá (đồng, để trống = liên hệ)"), { target: { value: price } });
  fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "tao goi cho khach hang" } });
}

function teamSection() {
  const heading = screen.getByRole("heading", { name: "Team" });
  const section = heading.closest("section");
  if (!section) throw new Error("team section missing");
  return section;
}

describe("AdminPlansView", () => {
  it("renders plan catalog rows", () => {
    render(<AdminPlansView />);
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getAllByText("members.max").length).toBeGreaterThan(0);
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

  it("sends a whole price from either thousands separator and blocks a price that is not a number", () => {
    createPlan.mockClear();
    const { unmount } = render(<AdminPlansView />);
    openCreate("499.000");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ price_amount: 499000 }));
    unmount();

    createPlan.mockClear();
    render(<AdminPlansView />);
    openCreate("499,000");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ price_amount: 499000 }));

    fireEvent.change(screen.getByLabelText("Giá (đồng, để trống = liên hệ)"), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
  });

  it("sends a whole quota and disables save when the quota is not a whole number", () => {
    updateFeature.mockClear();
    render(<AdminPlansView />);
    const members = screen.getAllByText("members.max")[1]?.closest("tr");
    if (!members) throw new Error("members row missing");
    const quota = within(members).getByPlaceholderText("Không giới hạn");
    fireEvent.change(quota, { target: { value: "1,000" } });
    fireEvent.click(within(members).getByRole("button", { name: "Lưu" }));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "nang han muc thanh vien" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(updateFeature).toHaveBeenCalledWith(expect.objectContaining({ quota_limit: 1000 }));

    for (const bad of ["abc", "-5"]) {
      fireEvent.change(quota, { target: { value: bad } });
      expect(within(members).getByRole("button", { name: "Lưu", hidden: true })).toBeDisabled();
    }
  });

  it("keeps a storage quota typed with a decimal comma", () => {
    updateFeature.mockClear();
    render(<AdminPlansView />);
    const storage = screen.getByText("storage.bytes").closest("tr");
    if (!storage) throw new Error("storage row missing");
    fireEvent.change(within(storage).getByLabelText("Dung lượng lưu trữ tính bằng GB"), { target: { value: "1,5" } });
    fireEvent.click(within(storage).getByRole("button", { name: "Lưu" }));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "dat dung luong luu tru" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    expect(updateFeature).toHaveBeenCalledWith(expect.objectContaining({ quota_limit: Math.round(1.5 * 1024 ** 3) }));
  });

  it("shows an error toast and keeps the dialog open when the server rejects the write", async () => {
    updatePlan.mockRejectedValueOnce(new Error("code gói đã tồn tại"));
    render(<AdminPlansView />);
    fireEvent.click(within(teamSection()).getByRole("button", { name: "Sửa gói" }));
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "sua mo ta goi team" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("code gói đã tồn tại"));
    expect(screen.getByRole("heading", { name: "Sửa gói team" })).toBeInTheDocument();
  });

  it("reopens the edit form on the saved price after cancel", () => {
    render(<AdminPlansView />);
    fireEvent.click(within(teamSection()).getByRole("button", { name: "Sửa gói" }));
    const price = screen.getByLabelText("Giá (đồng, để trống = liên hệ)");
    expect(price).toHaveValue("499000");
    fireEvent.change(price, { target: { value: "999000" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    fireEvent.click(within(teamSection()).getByRole("button", { name: "Sửa gói" }));
    expect(screen.getByLabelText("Giá (đồng, để trống = liên hệ)")).toHaveValue("499000");
  });
});
