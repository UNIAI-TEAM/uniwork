import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { OnboardingFlow } from "./onboarding-flow";

initI18n();

vi.mock("@uniwork/core/auth", () => ({
  useSession: () => ({
    status: "authed",
    user: { id: "u1", email: "a@x.com", display_name: "A", onboarded_at: null, email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} },
  }),
  useLogout: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces") return Promise.resolve({ workspaces: [] });
    if (path === "/api/v1/orgs") return Promise.resolve({ organizations: [] });
    return Promise.resolve({ user: { id: "u1", email: "a@x.com", display_name: "A", onboarded_at: null, email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} } });
  });
});

describe("OnboardingFlow", () => {
  it("walks welcome → about you → organization, and rail goes back", async () => {
    render(wrap(<OnboardingFlow onComplete={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: /Bắt đầu/ }));
    expect(screen.getByText("Cho chúng tôi biết đôi chút về bạn.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua" }));
    expect(await screen.findByRole("heading", { name: "Đặt tên tổ chức của bạn." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Về bạn/ }));
    expect(screen.getByText("Cho chúng tôi biết đôi chút về bạn.")).toBeInTheDocument();
  });
  it("new_workspace mode starts at organization and cancels from its back", async () => {
    const onCancel = vi.fn();
    render(wrap(<OnboardingFlow onComplete={() => {}} mode="new_workspace" onCancel={onCancel} />));
    expect(await screen.findByRole("heading", { level: 1, name: /tổ chức/i })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Quay lại" })[0]!);
    expect(onCancel).toHaveBeenCalled();
  });
});
