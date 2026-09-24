import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { registerPushAdapter } from "@uniwork/core/platform";
import { NOTIFICATION_KINDS } from "@uniwork/core/types/notification";
import { requestMock, wrap } from "../../test/api-mock";
import { NotificationsTab } from "./notifications-tab";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

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
  toastSuccess.mockReset();
  toastError.mockReset();
  registerPushAdapter(null);
});

describe("NotificationsTab", () => {
  it("renders every kind, hides the push column when the server cannot push, and saves a toggle", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    expect(await screen.findByRole("rowheader", { name: /Được giao việc/ })).toBeInTheDocument();
    // One row per kind, plus the "every kind" row that carries the channel toggles.
    expect(screen.getAllByRole("rowheader")).toHaveLength(NOTIFICATION_KINDS.length + 1);
    expect(screen.getByRole("rowheader", { name: "Mọi loại" })).toBeInTheDocument();
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
    // Saved state is inline; a toast per switch was noise.
    expect(await screen.findByText("Đã lưu")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    // Without push, one quiet line says why the column is missing.
    expect(screen.getByText(/Máy chủ này chưa bật thông báo đẩy/)).toBeInTheDocument();
  });

  it("keeps the rest of the matrix live while one row saves", async () => {
    mockApi(false);
    let release: (v: unknown) => void = () => {};
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: false, public_key: "" });
      if (init?.method === "PUT") return new Promise((resolve) => (release = resolve));
      return Promise.resolve({ preferences: prefs });
    });
    render(wrap(<NotificationsTab />));
    const mentionedEmail = await screen.findByRole("switch", { name: "Được nhắc đến · Email" });
    fireEvent.click(mentionedEmail);

    // The toggled row shows the new value and waits; another row is untouched.
    await waitFor(() => expect(mentionedEmail).toHaveAttribute("aria-busy", "true"));
    expect(mentionedEmail).toHaveAttribute("aria-checked", "true");
    const assignedEmail = screen.getByRole("switch", { name: "Được giao việc · Email" });
    expect(assignedEmail).not.toHaveAttribute("aria-busy");
    expect(assignedEmail).not.toHaveAttribute("data-disabled");
    expect(screen.getByText("Đang lưu…")).toBeInTheDocument();

    release({ preferences: [{ kind: "mentioned", in_app: true, push: true, email: true }] });
    await waitFor(() => expect(mentionedEmail).not.toHaveAttribute("aria-busy"));
  });

  it("turns one channel off for every kind in a single request", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    const allEmail = await screen.findByRole("switch", { name: "Email cho mọi loại" });
    // "mentioned" has email off, so the channel is not on everywhere yet.
    expect(allEmail).toHaveAttribute("aria-checked", "false");
    fireEvent.click(allEmail);

    await waitFor(() => expect(requestMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "PUT")).toHaveLength(1));
    const put = requestMock.mock.calls.find(([, init]) => (init as { method?: string })?.method === "PUT")!;
    const sent = (put[1] as { body: { preferences: { kind: string; email: boolean }[] } }).body.preferences;
    // Only the kinds that were off are written, all of them switched on.
    expect(sent.map((p) => p.kind)).toEqual(["mentioned"]);
    expect(sent.every((p) => p.email)).toBe(true);
    expect(await screen.findByRole("switch", { name: "Email cho mọi loại" })).toHaveAttribute("aria-checked", "true");
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

  it("shows a load error with retry instead of a guessed matrix, and writes nothing", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: false, public_key: "" });
      if (path === "/api/v1/me/notification-preferences") {
        return fail ? Promise.reject(new ApiError("boom", "internal", 500)) : Promise.resolve({ preferences: prefs });
      }
      return Promise.resolve({ status: "ok" });
    });
    render(wrap(<NotificationsTab />));
    expect(await screen.findByText("Không tải được phần này.")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("switch", { name: "Được nhắc đến · Email" })).toHaveAttribute("aria-checked", "false");
    expect(requestMock.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === "PUT")).toBe(false);
  });

  it("reports a failed toggle inline only, with no toast", async () => {
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: false, public_key: "" });
      if (init?.method === "PUT") return Promise.reject(new ApiError("boom", "internal", 500));
      return Promise.resolve({ preferences: prefs });
    });
    render(wrap(<NotificationsTab />));
    fireEvent.click(await screen.findByRole("switch", { name: "Được nhắc đến · Email" }));
    expect(await screen.findByText("Không lưu được")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("explains a refused browser permission under the switch, not in a toast", async () => {
    mockApi(true);
    registerPushAdapter({
      permission: () => "default",
      requestPermission: () => Promise.resolve("denied"),
      current: () => Promise.resolve(null),
      subscribe: () => Promise.reject(new Error("unreachable")),
      unsubscribe: () => Promise.resolve(null),
    });
    render(wrap(<NotificationsTab />));
    const browser = await screen.findByRole("switch", { name: "Nhận thông báo đẩy trên trình duyệt này" });
    await waitFor(() => expect(browser).not.toHaveAttribute("aria-busy"));
    fireEvent.click(browser);
    await waitFor(() => expect(browser).toHaveAccessibleDescription(/Trình duyệt đang chặn thông báo/));
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByText("Không lưu được")).toBeNull();
  });
});
