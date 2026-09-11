import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { registerPushAdapter } from "@uniwork/core/platform";
import { NOTIFICATION_KINDS } from "@uniwork/core/types/notification";
import { requestMock, wrap } from "../../test/api-mock";
import { NotificationsTab } from "./notifications-tab";

initI18n();

const prefs = [
  { kind: "task_assigned", in_app: true, push: true, email: true },
  { kind: "mentioned", in_app: true, push: true, email: false },
];

function mockApi(pushEnabled: boolean) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: pushEnabled, public_key: "BOr" });
    if (path === "/api/v1/me/notification-preferences") {
      if (init?.method === "PUT") return Promise.resolve({ preferences: (init.body as { preferences: unknown[] }).preferences });
      return Promise.resolve({ preferences: prefs });
    }
    return Promise.resolve({ status: "ok" });
  });
}

beforeEach(() => {
  requestMock.mockReset();
  registerPushAdapter(null);
});

describe("NotificationsTab", () => {
  it("renders every kind, hides the push column when the server cannot push, and saves a toggle", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    expect(await screen.findByRole("rowheader", { name: /Được giao việc/ })).toBeInTheDocument();
    expect(screen.getAllByRole("rowheader")).toHaveLength(NOTIFICATION_KINDS.length);
    expect(screen.queryByRole("columnheader", { name: "Đẩy" })).toBeNull();
    expect(screen.queryByText("Thông báo đẩy")).toBeNull();

    const emailSwitch = screen.getByRole("switch", { name: "Được nhắc đến · Email" });
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(emailSwitch);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/me/notification-preferences",
        expect.objectContaining({
          method: "PUT",
          body: { preferences: [{ kind: "mentioned", in_app: true, push: true, email: true }] },
        }),
      ),
    );
  });

  it("shows the push column and the browser switch when push is available", async () => {
    mockApi(true);
    registerPushAdapter({
      permission: () => "default",
      requestPermission: () => Promise.resolve("granted"),
      current: () => Promise.resolve(null),
      subscribe: () => Promise.resolve({ endpoint: "https://p/x", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: () => Promise.resolve(null),
    });
    render(wrap(<NotificationsTab />));
    expect(await screen.findByRole("columnheader", { name: "Đẩy" })).toBeInTheDocument();
    const browser = await screen.findByRole("switch", { name: "Nhận thông báo đẩy trên trình duyệt này" });
    fireEvent.click(browser);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/me/push-subscriptions",
        expect.objectContaining({ method: "POST", body: { endpoint: "https://p/x", keys: { p256dh: "p", auth: "a" } } }),
      ),
    );
  });
});
