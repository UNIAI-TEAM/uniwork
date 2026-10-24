import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { emptyDraft, type MeetingDraft } from "../meetings/meeting-sheet/draft-model";
import { MeetingQuickCard } from "./meeting-quick-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const me: User = {
  id: "u-lan",
  email: "lan@x.com",
  display_name: "Lan Phạm",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const members = [
  { workspace_id: "w1", user_id: "u-lan", role: "owner", email: "lan@x.com", display_name: "Lan Phạm" },
  { workspace_id: "w1", user_id: "u-minh", role: "member", email: "minh@x.com", display_name: "Minh Trần" },
];
const NOW = new Date("2026-10-23T14:18:00Z").getTime();
const initial: MeetingDraft = { ...emptyDraft(NOW, "Asia/Ho_Chi_Minh"), date: "2026-10-26", start: "10:00", end: "11:00" };
const created = {
  id: "new1",
  workspace_id: "w1",
  title: "Duyệt kịch bản",
  description: "",
  host_user_id: "u-lan",
  timezone: "Asia/Ho_Chi_Minh",
  starts_at: "2026-10-26T03:00:00Z",
  ends_at: "2026-10-26T04:00:00Z",
  room_name: "r",
  created_by: "u-lan",
  status: "SCHEDULED",
  scribe_enabled: true,
};

type Init = { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> };

function serve(over: (path: string, init: Init) => unknown = () => undefined) {
  requestMock.mockImplementation((p: unknown, i?: Init) => {
    const path = String(p);
    const init = i ?? {};
    const own = over(path, init);
    if (own !== undefined) return own instanceof Promise ? own : Promise.resolve(own);
    if (path.endsWith("/members")) return Promise.resolve({ members });
    if (path.endsWith("/meeting-capabilities")) return Promise.resolve({ scribe: true, scribe_policy: "on" });
    if (path === "/api/v1/workspaces/w1/meetings" && init.method === "POST") return Promise.resolve({ meeting: created });
    if (path.endsWith("/invitations")) {
      return Promise.resolve({ participant: { id: "p1", meeting_id: "new1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE" } });
    }
    return Promise.resolve({});
  });
}

const posts = (suffix: string) =>
  requestMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix) && (c[1] as Init | undefined)?.method === "POST");

function renderCard() {
  const props = { onClose: vi.fn(), onMoreOptions: vi.fn(), onOpenMeeting: vi.fn() };
  render(wrapWithNav(<MeetingQuickCard workspaceId="w1" initial={initial} anchor={document.body} {...props} />));
  return { ...props, card: screen.getByRole("dialog") };
}

async function pickMinh(card: HTMLElement) {
  const search = within(card).getByRole("combobox", { name: "Người tham dự" });
  fireEvent.change(search, { target: { value: "Minh" } });
  await within(card).findByRole("option", { name: "Minh Trần" });
  fireEvent.keyDown(search, { key: "Enter" });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requestMock.mockReset();
  for (const fn of [toast.success, toast.error, toast.warning]) vi.mocked(fn).mockClear();
  setSessionUser(me);
  serve();
});

afterEach(() => vi.useRealTimers());

describe("MeetingQuickCard", () => {
  it("draws the slot line, the title in focus and the organization's scribe default", async () => {
    const { card } = renderCard();
    expect(within(card).getByRole("button", { name: /^Thời gian: Thứ Hai 26\/10, 10:00 đến 11:00, 1 giờ/ })).toHaveTextContent(
      "Thứ Hai 26/10 · 10:00–11:00 · 1 giờ",
    );
    await waitFor(() => expect(within(card).getByLabelText("Tiêu đề")).toHaveFocus());
    expect(within(card).getByLabelText("Tiêu đề")).toBeRequired();
    expect(await within(card).findByText("Thư ký UNI: Bật · theo tổ chức")).toBeInTheDocument();
  });

  it("never lets a plain Enter in the people search create the meeting", () => {
    const { card } = renderCard();
    const search = within(card).getByRole("combobox", { name: "Người tham dự" });
    fireEvent.change(search, { target: { value: "zzz" } });
    // fireEvent returns false when the default (implicit form submit) was prevented.
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(posts("/meetings")).toHaveLength(0);
  });

  it("opens the time row in place from the slot line", () => {
    const { card } = renderCard();
    const line = within(card).getByRole("button", { name: /^Thời gian:/ });
    fireEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getAllByLabelText("Giờ bắt đầu").length).toBeGreaterThan(0);
  });

  it("asks for a title instead of sending an empty one", () => {
    const { card } = renderCard();
    fireEvent.click(within(card).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(within(card).getByText("Nhập tiêu đề để tiếp tục")).toBeInTheDocument();
    expect(within(card).getByLabelText("Tiêu đề")).toHaveAttribute("aria-invalid", "true");
    expect(posts("/meetings")).toHaveLength(0);
  });

  it("creates with ⌘↵, invites through the invitations route and stays on the calendar", async () => {
    const { card, onClose, onOpenMeeting } = renderCard();
    fireEvent.change(within(card).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản" } });
    await pickMinh(card);
    fireEvent.keyDown(within(card).getByLabelText("Tiêu đề"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [, init] = posts("/workspaces/w1/meetings")[0]! as [string, Init];
    expect(init.body).toMatchObject({ title: "Duyệt kịch bản", attendee_user_ids: [], starts_at: "2026-10-26T03:00:00.000Z" });
    expect(init.headers?.["Idempotency-Key"]).toEqual(expect.any(String));
    expect((posts("/invitations")[0]![1] as Init).body).toEqual({ user_id: "u-minh" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã tạo cuộc họp", expect.anything()));
    const options = vi.mocked(toast.success).mock.calls[0]![1] as unknown as { action: { onClick: () => void } };
    options.action.onClick();
    expect(onOpenMeeting).toHaveBeenCalledWith("new1");
  });

  it("names who was not invited in a toast that stays, with Mời lại", async () => {
    serve((path) => (path.endsWith("/invitations") ? Promise.reject(new ApiError("không mời được", "forbidden", 403)) : undefined));
    const { card, onClose } = renderCard();
    fireEvent.change(within(card).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản" } });
    await pickMinh(card);
    fireEvent.click(within(card).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Đã tạo cuộc họp. Chưa mời được: Minh Trần.",
        expect.objectContaining({ duration: Infinity, action: expect.objectContaining({ label: "Mời lại" }) }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the card and says why when the create fails", async () => {
    serve((path, init) =>
      path === "/api/v1/workspaces/w1/meetings" && init.method === "POST" ? Promise.reject(new ApiError("hỏng", "internal", 500)) : undefined,
    );
    const { card, onClose } = renderCard();
    fireEvent.change(within(card).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản" } });
    fireEvent.click(within(card).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(/^Chưa tạo được cuộc họp\./);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(card).getByLabelText("Tiêu đề")).toHaveValue("Duyệt kịch bản");
  });

  it("hands the exact draft to the full sheet", async () => {
    const { card, onMoreOptions } = renderCard();
    fireEvent.change(within(card).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản" } });
    await pickMinh(card);
    fireEvent.click(within(card).getByRole("button", { name: "Thêm tùy chọn" }));
    expect(onMoreOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Duyệt kịch bản", date: "2026-10-26", start: "10:00", end: "11:00", people: [{ userId: "u-minh", role: "MEMBER" }] }),
    );
  });
});
