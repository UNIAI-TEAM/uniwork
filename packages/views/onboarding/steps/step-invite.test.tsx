import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { StepInvite } from "./step-invite";
import { expectInactive } from "../../test/inactive";

initI18n();
beforeEach(() => requestMock.mockReset());

describe("StepInvite", () => {
  const ws = { id: "w1", slug: "doi-alpha", name: "Đội Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" };
  it("finish disabled until sent; skip always available", async () => {
    requestMock.mockResolvedValueOnce({ invitations: [{ id: "i1", email: "b@x.com", role: "member", token: "tok" }], skipped: [] });
    const onFinish = vi.fn();
    const onSkip = vi.fn();
    render(wrap(<StepInvite workspace={ws} onFinish={onFinish} onSkip={onSkip} />));
    expectInactive(screen.getByRole("button", { name: "Hoàn tất" }));
    expectInactive(screen.getByRole("button", { name: "Gửi lời mời" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "b@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(screen.getByText("Đã tạo 1 lời mời")).toBeInTheDocument());
    expect(screen.getByText(/\/invite\/tok/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoàn tất" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua, mời sau" }));
    expect(onSkip).toHaveBeenCalled();
  });
});
