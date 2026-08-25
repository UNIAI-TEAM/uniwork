import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { resetWelcome, setWelcomeSignal } from "@uniwork/core/onboarding";
import { requestMock, wrap } from "../test/api-mock";
import { WelcomeAfterOnboarding } from "./welcome-after-onboarding";

initI18n();
beforeEach(() => {
  requestMock.mockReset();
  resetWelcome();
});
const ws = { id: "w1", slug: "a", name: "A", organization_id: "o", organization_slug: "o", organization_name: "O" };
const task = { id: "t1", workspace_id: "w1", title: "Bắt đầu với UniWork", description: "", status: "in_progress", priority: "high", position: 1, created_by: "u", created_at: "", updated_at: "", kind: "welcome" };

describe("WelcomeAfterOnboarding", () => {
  it("renders nothing without signal", () => {
    const { container } = render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
  it("seeds task then shows 🎉 dialog; got it opens task", async () => {
    requestMock.mockResolvedValueOnce({ task });
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    const gotIt = await screen.findByRole("button", { name: "Đã hiểu" });
    expect(screen.getAllByText("Chào mừng đến UniWork!").length).toBeGreaterThan(0);
    fireEvent.click(gotIt);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
  it("shows retry dialog on failure", async () => {
    requestMock.mockRejectedValueOnce(new Error("x"));
    setWelcomeSignal("w1");
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(await screen.findByText("Chưa chuẩn bị được workspace")).toBeInTheDocument();
  });
});
