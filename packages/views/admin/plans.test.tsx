import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminPlansView } from "./plans";

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
  useCreateAdminPlan: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateAdminPlan: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateAdminPlanFeature: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

describe("AdminPlansView", () => {
  it("renders plan catalog rows", () => {
    render(<AdminPlansView />);
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getByText("members.max")).toBeInTheDocument();
  });
});
