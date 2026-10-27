import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { memoryRecordingStore, type RecordingStore } from "@uniwork/core/meetings/recorder";
import type { User } from "@uniwork/core/types";
import { fakeNav, wrapWithNav } from "../../test/api-mock";
import { ChatSettingsPage } from "./chat-settings-page";

// Sign-out reads this device's recordings from the shared store; each test hands it a fresh one.
const device = vi.hoisted(() => ({ store: undefined as RecordingStore | undefined }));
vi.mock("@uniwork/core/meetings/recorder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/meetings/recorder")>();
  return {
    ...actual,
    useUnsentRecordings: (userId: string | undefined, meetingId?: string) => actual.useUnsentRecordings(userId, meetingId, device.store),
  };
});

initI18n();

const w = window as unknown as { desktopAPI?: unknown };

beforeEach(() => {
  resetAuthStoreForTests();
  device.store = memoryRecordingStore();
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

  it("asks before signing out with a recording still on this device", async () => {
    await device.store!.createPart({
      id: "p1", userId: "u1", meetingId: "m1", startedAt: 1_000, lastChunkAt: 60_000, endedAt: 60_000,
      mimeType: "audio/webm", bytes: 10, language: "vi", offsetSeconds: 0,
    });
    const logout = vi.fn(async () => {});
    useAuthStore.setState({ logout });
    render(wrapWithNav(<ChatSettingsPage />, fakeNav("/unicom/tt/chat/settings")));
    fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(await screen.findByRole("alertdialog", { name: "Còn 1 bản ghi chưa gửi" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
    expect(logout).not.toHaveBeenCalled();
  });
});
