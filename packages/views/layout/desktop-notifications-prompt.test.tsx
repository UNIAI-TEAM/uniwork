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
  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = "granted";
      return "granted" as NotificationPermission;
    });
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, body: options?.body });
    }
    close() {}
  }
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  delete (window as Window & { desktopAPI?: unknown }).desktopAPI;
  vi.unstubAllGlobals();
});

describe("DesktopNotificationsPrompt", () => {
  it("asks on macOS, sends a test notification, then points at the OS settings", async () => {
    const openNotificationSettings = vi.fn(() => Promise.resolve());
    inShell("macos", openNotificationSettings);
    render(<DesktopNotificationsPrompt />);
    expect(screen.getByText("Bật thông báo để không bỏ lỡ tin nhắn mới.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    await vi.waitFor(() =>
      expect(shown).toEqual([{ title: "Thông báo đã bật", body: "Tin nhắn mới sẽ hiện ở đây." }]),
    );
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

  it("offers no settings link in a shell that predates it", async () => {
    inShell("macos");
    render(<DesktopNotificationsPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Xong" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Mở cài đặt thông báo" })).toBeNull();
  });

  it("asks on Windows and requests permission before the test banner", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    class WinNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = requestPermission.mockImplementation(async () => {
        WinNotification.permission = "granted";
        return "granted";
      });
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, body: options?.body });
      }
      close() {}
    }
    vi.stubGlobal("Notification", WinNotification);

    inShell("windows", () => Promise.resolve());
    render(<DesktopNotificationsPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(shown).toEqual([{ title: "Thông báo đã bật", body: "Tin nhắn mới sẽ hiện ở đây." }]),
    );
  });

  it("renders nothing without a desktop shell", () => {
    render(<DesktopNotificationsPrompt />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders nothing once permission is already granted", () => {
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
        constructor(title: string, options?: NotificationOptions) {
          shown.push({ title, body: options?.body });
        }
        close() {}
      },
    );
    inShell("windows", () => Promise.resolve());
    render(<DesktopNotificationsPrompt />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
