import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AcceptInviteView } from "./accept-invite-view";

initI18n();
beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

const me: User = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarded_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const signIn = () => setSessionUser(me);

describe("AcceptInviteView", () => {
  it("sends a signed-out visitor to login instead of accepting the invite", async () => {
    // Phiên chưa xác định khi mount, nên chờ nó ngã ngũ thành anon.
    requestMock.mockResolvedValue(null);
    const onAnon = vi.fn();
    render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={() => {}} onAnon={onAnon} />));
    await waitFor(() => expect(onAnon).toHaveBeenCalled());
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("/accept"))).toBe(false);
  });

  /**
   * Bản cũ đổ thẳng `message` của server ra trang: người dùng Việt nhận đúng hai
   * chữ "not found" trên nền trắng, không tiêu đề và không lối đi tiếp.
   */
  it("translates a dead invite instead of printing the server's English message", async () => {
    signIn();
    requestMock.mockRejectedValueOnce(new ApiError("not found", "not_found", 404));
    render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={() => {}} onAnon={() => {}} />));
    expect(await screen.findByRole("heading", { name: "Không dùng được lời mời này" })).toBeInTheDocument();
    expect(screen.queryByText("not found")).not.toBeInTheDocument();
  });

  it("offers a way forward and announces the failure", async () => {
    signIn();
    requestMock.mockRejectedValueOnce(new ApiError("not found", "not_found", 404));
    render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={() => {}} onAnon={() => {}} />));
    expect(await screen.findByRole("link", { name: "Xem workspace của tôi" })).toHaveAttribute("href", "/workspaces");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  /** Mã lạ không được lộ chuỗi tiếng Anh của server ra màn hình. */
  it("falls back to a generic sentence for an unmapped error code", async () => {
    signIn();
    requestMock.mockRejectedValueOnce(new ApiError("internal explosion", "boom", 500));
    render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={() => {}} onAnon={() => {}} />));
    expect(await screen.findByText("Chúng tôi chưa xử lý được lời mời này.")).toBeInTheDocument();
    expect(screen.queryByText("internal explosion")).not.toBeInTheDocument();
  });
});
