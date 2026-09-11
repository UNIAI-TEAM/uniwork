import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminLayout } from "./layout";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

function nav(pathname = "/admin"): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname, searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminLayout", () => {
  it("sends a caller without a platform role home on 404 and renders nothing", async () => {
    requestMock.mockRejectedValue(new ApiError("not found", "not_found", 404));
    const adapter = nav();
    render(wrapWithNav(<AdminLayout><p>secret</p></AdminLayout>, adapter));
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("sends an anonymous caller to login with the return path", async () => {
    requestMock.mockRejectedValue(new ApiError("unauthorized", "unauthorized", 401));
    const adapter = nav("/admin/system");
    render(wrapWithNav(<AdminLayout><p>secret</p></AdminLayout>, adapter));
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fsystem"));
  });

  it("renders the nav, the role and the page for a platform admin", async () => {
    requestMock.mockResolvedValue({ platform_role: "support" });
    const adapter = nav("/admin/flags");
    render(wrapWithNav(<AdminLayout><p>page body</p></AdminLayout>, adapter));
    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(screen.getByText("support")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Tổ chức" })).not.toHaveAttribute("aria-current");
    expect(adapter.replace).not.toHaveBeenCalled();
  });

  it("shows an error with retry on any other failure", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrapWithNav(<AdminLayout><p>secret</p></AdminLayout>, nav()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được vai trò quản trị");
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
