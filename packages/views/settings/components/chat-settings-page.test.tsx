import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { fakeNav, wrapWithNav } from "../../test/api-mock";
import { ChatSettingsPage } from "./chat-settings-page";

initI18n();

const w = window as unknown as { desktopAPI?: unknown };

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser({ id: "u1", email: "demo@uniwork.local", display_name: "Demo UniChat" } as User);
});

afterEach(() => {
  delete w.desktopAPI;
});

describe("ChatSettingsPage", () => {
  it("lists the person's own sections beside who is signed in, the profile open first", () => {
    render(wrapWithNav(<ChatSettingsPage />, fakeNav("/unicom/tt/chat/settings")));
    const nav = screen.getByRole("complementary", { name: "Mục cài đặt" });
    expect(nav).toHaveTextContent("Demo UniChat");
    expect(nav).toHaveTextContent("demo@uniwork.local");
    expect(screen.getByRole("button", { name: "Hồ sơ" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Thông báo", "Tùy chọn", "Bảo mật", "Phím tắt", "Về UniChat", "Đăng xuất"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // The organization's and the workspace's settings stay on the web.
    expect(screen.queryByRole("button", { name: "Thanh toán" })).not.toBeInTheDocument();
  });

  it("keeps the section in ?tab= and says which version this computer runs", () => {
    w.desktopAPI = { app: "unichat", appInfo: { version: "0.1.0-beta.2", os: "macos" } };
    const nav = fakeNav("/unicom/tt/chat/settings");
    render(wrapWithNav(<ChatSettingsPage />, nav));
    fireEvent.click(screen.getByRole("button", { name: "Về UniChat" }));
    expect(nav.replace).toHaveBeenCalledWith("/unicom/tt/chat/settings?tab=about");
    expect(screen.getByRole("heading", { name: "Về UniChat" })).toBeInTheDocument();
    expect(screen.getByText("Phiên bản 0.1.0-beta.2 · macOS")).toBeInTheDocument();
  });
});
