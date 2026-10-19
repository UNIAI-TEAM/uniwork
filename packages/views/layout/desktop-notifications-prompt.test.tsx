import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DesktopNotificationsPrompt } from "./desktop-notifications-prompt";

initI18n();

type Shell = { app: "unichat"; appInfo: { version: string; os: string }; openNotificationSettings?: () => Promise<void> };

function inShell(os: string, openNotificationSettings?: () => Promise<void>) {
  const bridge: Shell = { app: "unichat", appInfo: { version: "1.0.0", os } };
  if (openNotificationSettings) bridge.openNotificationSettings = openNotificationSettings;
  (window as Window & { desktopAPI?: unknown }).desktopAPI = bridge;
}

let shown: Array<{ title: string; body?: string }> = [];

beforeEach(() => {
  shown = [];
  localStorage.clear();
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, body: options?.body });
      }
      close() {}
    },
  );
});

afterEach(() => {
  delete (window as Window & { desktopAPI?: unknown }).desktopAPI;
  vi.unstubAllGlobals();
});

describe("DesktopNotificationsPrompt", () => {
  it("asks on macOS, sends a test notification, then points at the OS settings", () => {
    const openNotificationSettings = vi.fn(() => Promise.resolve());
    inShell("macos", openNotificationSettings);
    render(<DesktopNotificationsPrompt />);
    expect(screen.getByText("Bật thông báo để không bỏ lỡ tin nhắn mới.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    expect(shown).toEqual([{ title: "Thông báo đã bật", body: "Tin nhắn mới sẽ hiện ở đây." }]);
    expect(screen.getByRole("status")).toHaveTextContent("Khi macOS hỏi, chọn Cho phép.");

    fireEvent.click(screen.getByRole("button", { name: "Mở cài đặt thông báo" }));
    expect(openNotificationSettings).toHaveBeenCalledOnce();
  });

  it("stays closed on this computer once dismissed", () => {
    inShell("macos", () => Promise.resolve());
    const { unmount } = render(<DesktopNotificationsPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByRole("region")).toBeNull();
    unmount();

    render(<DesktopNotificationsPrompt />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("offers no settings link in a shell that predates it", () => {
    inShell("macos");
    render(<DesktopNotificationsPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    expect(screen.queryByRole("button", { name: "Mở cài đặt thông báo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Xong" })).toBeInTheDocument();
  });

  // Windows shows notifications without asking; the web has no shell at all.
  it.each(["windows", "linux", null])("renders nothing outside the macOS shell (%s)", (os) => {
    if (os) inShell(os, () => Promise.resolve());
    render(<DesktopNotificationsPrompt />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
