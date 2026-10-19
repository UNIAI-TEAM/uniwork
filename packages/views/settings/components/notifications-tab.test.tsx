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

const { t } = initI18n();

const prefs = [
  { kind: "task_assigned", in_app: true, push: true, email: true },
  { kind: "mentioned", in_app: true, push: true, email: false },
];

/** The PUT body and read-back call shape the transport hands the mock. */
type PrefsBody = { preferences: { kind: string; email: boolean }[] };
type RequestCall = [string, { method?: string; body?: PrefsBody }?];

function mockApi(pushEnabled: boolean) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: PrefsBody }) => {
    if (path === "/api/v1/notifications/push/config") return Promise.resolve({ enabled: pushEnabled, public_key: "BOr" });
    if (path === "/api/v1/me/notification-preferences") {
      if (init?.method === "PUT") {
        // The real server answers with the effective rows: document_trashed_by_other
        // can never hold email (Matrix.For's ceiling), so echoing the request would
        // show a state the backend never returns (BE-TN-11).
        return Promise.resolve({
          preferences: (init.body?.preferences ?? []).map((p) => ({
            ...p,
            email: p.email && p.kind !== "document_trashed_by_other",
          })),
        });
      }
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
    // One row per kind, plus the "every kind" row that carries the channel
    // toggles, plus one heading per inbox category the kinds are grouped by.
    expect(screen.getAllByRole("rowheader")).toHaveLength(NOTIFICATION_KINDS.length + 1 + 5);
    expect(screen.getByRole("rowheader", { name: "Mọi loại" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Cuộc họp" })).toHaveAttribute("scope", "rowgroup");
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

  it("bulk-toggles email for every kind that can hold it, never the trash kind", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    // "mentioned" has email off, so the channel is on for some kinds: mixed, not off.
    expect(await screen.findByRole("checkbox", { name: "Email cho mọi loại phù hợp" })).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("checkbox", { name: "Hộp việc cho mọi loại" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Email cho mọi loại" })).toBeNull();

    const puts = () => (requestMock.mock.calls as RequestCall[]).filter(([, init]) => init?.method === "PUT");
    const sentOf = (call: RequestCall | undefined) => call?.[1]?.body?.preferences ?? [];

    // Mixed turns everything on: only the kinds that were off are written, all of
    // them switched on. The omitted trash kind defaults email off (Q-R2) but can
    // never hold it, so the bulk control does not claim it (BE-TN-11).
    fireEvent.click(screen.getByRole("checkbox", { name: "Email cho mọi loại phù hợp" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(sentOf(puts()[0]).map((p) => p.kind)).toEqual(["mentioned"]);
    expect(sentOf(puts()[0]).every((p) => p.email)).toBe(true);
    expect(await screen.findByRole("checkbox", { name: "Email cho mọi loại phù hợp" })).toHaveAttribute("aria-checked", "true");

    // Every eligible kind is on now, so the same click switches them all off -
    // and still leaves the ineligible trash kind out of the write.
    fireEvent.click(screen.getByRole("checkbox", { name: "Email cho mọi loại phù hợp" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    const off = sentOf(puts()[1]);
    expect(off).toHaveLength(NOTIFICATION_KINDS.length - 1);
    expect(off.every((p) => !p.email)).toBe(true);
    expect(off.map((p) => p.kind)).not.toContain("document_trashed_by_other");
    expect(await screen.findByRole("checkbox", { name: "Email cho mọi loại phù hợp" })).toHaveAttribute("aria-checked", "false");
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

  // A kind the server did not send reads as the server's own DefaultPrefs: the
  // emergency-access kind (and the discussion mention) push by default.
  it("fills a kind the server omitted with the server's push defaults", async () => {
    mockApi(true);
    registerPushAdapter({
      permission: () => "default",
      requestPermission: () => Promise.resolve("granted"),
      current: () => Promise.resolve(null),
      subscribe: () => Promise.reject(new Error("unreachable")),
      unsubscribe: () => Promise.resolve(null),
    });
    render(wrap(<NotificationsTab />));
    const push = (kind: string) => screen.findByRole("switch", { name: `${kind} · Đẩy` });
    expect(await push("Truy cập khẩn cấp vào tài liệu")).toHaveAttribute("aria-checked", "true");
    expect(await push("Được nhắc đến trong thảo luận")).toHaveAttribute("aria-checked", "true");
    expect(await push("Phản hồi bình luận")).toHaveAttribute("aria-checked", "false");
    // The root's edit-lock kinds push by default too, except the answer.
    expect(await push("Yêu cầu quyền sửa tài liệu")).toHaveAttribute("aria-checked", "true");
    expect(await push("Bị lấy quyền sửa tài liệu")).toHaveAttribute("aria-checked", "true");
    expect(await push("Trả lời yêu cầu quyền sửa")).toHaveAttribute("aria-checked", "false");
  });

  // BE-TN-2: the trash kind carries a translated label, not a raw key, in vi.
  it("renders the trash kind with its settings label and switch labels", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    const header = await screen.findByRole("rowheader", { name: "Tài liệu của bạn bị chuyển vào thùng rác" });
    expect(header).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tài liệu của bạn bị chuyển vào thùng rác · Email" })).toBeInTheDocument();
  });

  // BE-TN-5: a kind the server omitted falls back to the server's own
  // defaults - for document_trashed_by_other that is in-app only, never
  // email; a toggle on the row must write that effective value back.
  it("omits the trash kind's email and writes it back off", async () => {
    mockApi(false);
    render(wrap(<NotificationsTab />));
    const email = await screen.findByRole("switch", {
      name: "Tài liệu của bạn bị chuyển vào thùng rác · Email",
    });
    expect(email).toHaveAttribute("aria-checked", "false");

    fireEvent.click(
      screen.getByRole("switch", { name: "Tài liệu của bạn bị chuyển vào thùng rác · Hộp việc" }),
    );
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/me/notification-preferences",
        expect.objectContaining({
          method: "PUT",
          body: {
            preferences: [
              { kind: "document_trashed_by_other", in_app: false, push: false, email: false },
            ],
          },
        }),
      ),
    );
  });

  // TRASH-NOTIFY-01: the trash notice is in-app only (prefs.go: push off, no digest email).
  it("fills the trash notice with in-app on, push off and email off when the server omitted it", async () => {
    mockApi(true);
    registerPushAdapter({
      permission: () => "default",
      requestPermission: () => Promise.resolve("granted"),
      current: () => Promise.resolve(null),
      subscribe: () => Promise.reject(new Error("unreachable")),
      unsubscribe: () => Promise.resolve(null),
    });
    render(wrap(<NotificationsTab />));
    const label = t("settings.notifications.kinds.document_trashed_by_other");
    expect(label).not.toBe("settings.notifications.kinds.document_trashed_by_other");
    const sw = (channel: string) => screen.findByRole("switch", { name: `${label} · ${channel}` });
    expect(await sw("Hộp việc")).toHaveAttribute("aria-checked", "true");
    expect(await sw("Đẩy")).toHaveAttribute("aria-checked", "false");
    expect(await sw("Email")).toHaveAttribute("aria-checked", "false");
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
