import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { toast } from "sonner";
import type { NavigationAdapter } from "../navigation";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDetailView } from "./meeting-detail-view";
import { clock } from "./meeting-detail/format";
import {
  DEMO_NOW,
  demo,
  demoUser,
  demoWorkspace,
  fixtureMeeting,
  routeMeeting,
  type DemoUserKey,
  type MeetingFixtureKey,
} from "./meeting-detail/test-fixtures";

initI18n();

const MINUTES_ON = { "/api/v1/config": { flags: { office_engine: false, meeting_minutes: true } } };

function nav(search = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/sao-mai/van-hanh/meetings/m",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function open(
  key: MeetingFixtureKey,
  {
    viewer,
    extra = {},
    adapter = nav(),
    props = {},
  }: {
    viewer?: DemoUserKey;
    extra?: Record<string, unknown>;
    adapter?: NavigationAdapter;
    props?: Partial<Parameters<typeof MeetingDetailView>[0]>;
  } = {},
) {
  const who = viewer ?? (key === "m1Outsider" ? "tuan" : "lan");
  routeMeeting(key, { viewer: who, extra });
  setSessionUser(demoUser(who));
  const handlers = { onJoin: vi.fn(), onDeleted: vi.fn() };
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <MeetingDetailView workspaceId={demoWorkspace.id} meetingId={fixtureMeeting(key).id} {...handlers} {...props} />
      </WorkspaceProvider>,
      adapter,
    ),
  );
  return { ...handlers, adapter };
}

const strip = async () => screen.findByRole("region", { name: /Việc tiếp theo của bạn|Quyền xem của bạn/ });

beforeEach(() => {
  requestMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEMO_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingDetailView › states", () => {
  it("says the meeting is gone instead of loading forever", async () => {
    requestMock.mockImplementation(() => Promise.reject(new ApiError("không tìm thấy", "not_found", 404)));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
          <MeetingDetailView workspaceId="w" meetingId="nope" onJoin={() => {}} onDeleted={() => {}} />
        </WorkspaceProvider>,
      ),
    );
    expect(await screen.findByRole("heading", { name: "Không tìm thấy cuộc họp" })).toBeInTheDocument();
    expect(screen.getByText("Cuộc họp không tồn tại hoặc bạn không có quyền xem.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về danh sách cuộc họp" })).toHaveAttribute("href", "/sao-mai-mvkm79lj/van-hanh/meetings");
  });

  it("offers a retry when the meeting could not be loaded", async () => {
    let calls = 0;
    const m1 = fixtureMeeting("m1");
    routeMeeting("m1");
    const routed = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, opts?: unknown) => {
      if (String(path) === `/api/v1/meetings/${m1.id}`) {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError("Failed to fetch"));
      }
      return routed(path, opts);
    });
    setSessionUser(demoUser("lan"));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
          <MeetingDetailView workspaceId={demoWorkspace.id} meetingId={m1.id} onJoin={() => {}} onDeleted={() => {}} />
        </WorkspaceProvider>,
      ),
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Không tải được cuộc họp." })).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { level: 1, name: m1.title })).toBeInTheDocument();
  });

  it("shows the page skeleton, not a blank body, while the meeting loads", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
          <MeetingDetailView workspaceId="w" meetingId="m" onJoin={() => {}} onDeleted={() => {}} />
        </WorkspaceProvider>,
      ),
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải cuộc họp…");
  });

  it("keeps the calendar panel's props: no breadcrumb trail, its own actions, one column", async () => {
    open("m3", { props: { layout: "panel", headerActions: <button type="button">Panel action</button> } });
    expect(await screen.findByRole("button", { name: "Panel action" })).toBeInTheDocument();
    expect(screen.getByTestId("meeting-detail-content")).toHaveClass("max-w-none");
    expect(screen.getByTestId("meeting-detail-sections")).toHaveClass("grid-cols-1");
    expect(screen.queryByRole("link", { name: "Cuộc họp" })).not.toBeInTheDocument();
  });
});

describe("MeetingDetailView › strip per state and viewer", () => {
  it("gives the host the start row before the meeting: when, who has not answered, start", async () => {
    open("m3");
    const row = await strip();
    // The clock is its own <time> inside the bold lead (kit `<strong>Bắt đầu ngày mai <time>14:00</time></strong>`).
    const lead = `Bắt đầu ngày mai ${clock(fixtureMeeting("m3").starts_at)}`;
    expect(await within(row).findByText((_, el) => el?.tagName === "STRONG" && el.textContent === lead)).toBeInTheDocument();
    expect(within(row).getByText("1 người chưa phản hồi: Minh Trần")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Thêm vào lịch" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Bắt đầu họp" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${fixtureMeeting("m3").id}/start`, expect.objectContaining({ method: "POST" })),
    );
    // Scheduled: no tabs.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("asks an invitee for an answer before the meeting", async () => {
    open("m3", { viewer: "minh" });
    const row = await strip();
    expect(await within(row).findByRole("radio", { name: "Tham dự" })).toBeInTheDocument();
    expect(within(row).getByRole("radio", { name: "Chưa chắc" })).toBeInTheDocument();
    expect(within(row).getByRole("radio", { name: "Từ chối" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Bắt đầu họp" })).not.toBeInTheDocument();
  });

  it("heads the live jobs with their count and lets the host end or join", async () => {
    const { onJoin } = open("m4");
    const row = await strip();
    expect(await within(row).findByRole("heading", { name: "Cần bạn · 2" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Vào phòng họp" }));
    expect(onJoin).toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Kết thúc họp" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Mọi người sẽ rời phòng và Thư ký UNI bắt đầu soạn tóm tắt.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Kết thúc họp" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${fixtureMeeting("m4").id}/end`, expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByRole("tablist", { name: "Phần của cuộc họp" })).toBeInTheDocument();
  });

  it("offers the host an extension or an end in overtime, and only explains it to anyone else", async () => {
    vi.setSystemTime(DEMO_NOW + 60 * 60_000);
    open("m4");
    const row = await strip();
    const end = clock(fixtureMeeting("m4").ends_at);
    expect(await within(row).findByText(`Đã qua giờ kết thúc ${end}. Phòng không nhận thêm người.`)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Gia hạn 15 phút" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(`/api/v1/meetings/${fixtureMeeting("m4").id}/extend`, expect.objectContaining({ method: "POST" })),
    );
    expect(within(row).getByRole("button", { name: "Kết thúc họp" }).className).toMatch(/destructive/);
  });

  it("explains overtime to an attendee without offering what only the host may do", async () => {
    vi.setSystemTime(DEMO_NOW + 60 * 60_000);
    open("m4", { viewer: "minh" });
    const row = await strip();
    expect(await within(row).findByText(/chủ trì có thể gia hạn/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Gia hạn 15 phút" })).not.toBeInTheDocument();
  });

  it("offers the host 'held' or a new time when the window passed unstarted, and the cancel in ⋯", async () => {
    open("m6");
    const row = await strip();
    expect(await within(row).findByText("Cuộc họp không diễn ra")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Ghi nhận đã họp" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Đặt lại lịch" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Hủy cuộc họp" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mô tả" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Thao tác khác: .*hủy cuộc họp/ })).toBeInTheDocument();
  });

  it("tells an attendee of a missed meeting who will reschedule it", async () => {
    open("m6", { viewer: "minh" });
    expect(await screen.findByText("Cuộc họp không diễn ra. Đang chờ Lan Phạm đặt lại lịch.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đặt lại lịch" })).not.toBeInTheDocument();
  });

  it("says who canceled and when, lists the invitees and lets the host restore while the time is ahead", async () => {
    open("m5");
    const routed = requestMock.getMockImplementation()!;
    // The restore stays in flight, so a second click meets it.
    requestMock.mockImplementation((path: unknown, opts?: unknown) =>
      String(path).endsWith("/restore") ? new Promise(() => {}) : routed(path, opts),
    );
    const row = await strip();
    expect(await within(row).findByText("Lan Phạm đã hủy")).toBeInTheDocument();
    expect(row).toHaveTextContent(/lúc \d\d:\d\d hôm nay\./);
    expect(screen.getByRole("heading", { name: "Người được mời" })).toBeInTheDocument();
    expect(screen.getAllByText("Chưa phản hồi")).toHaveLength(2);
    const restore = within(row).getByRole("button", { name: "Khôi phục" });
    fireEvent.click(restore);
    await waitFor(() => expect(restore).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(restore);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        `/api/v1/meetings/${fixtureMeeting("m5").id}/restore`,
        expect.objectContaining({ method: "POST", body: { version: fixtureMeeting("m5").version } }),
      ),
    );
    // In flight, the second click does nothing.
    expect(requestMock.mock.calls.filter(([p]) => String(p).endsWith("/restore"))).toHaveLength(1);
  });

  it("withdraws the restore once the canceled meeting's time has passed, and from a non-host", async () => {
    vi.setSystemTime(Date.parse(fixtureMeeting("m5").ends_at) + 60_000);
    open("m5");
    const row = await strip();
    await within(row).findByText("Lan Phạm đã hủy");
    expect(within(row).queryByRole("button", { name: "Khôi phục" })).not.toBeInTheDocument();
  });

  it("tells an invitee of a canceled meeting there is nothing to do", async () => {
    open("m5", { viewer: "minh" });
    const row = await strip();
    expect(await within(row).findByText(/Bạn không cần làm gì\./)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Khôi phục" })).not.toBeInTheDocument();
  });

  it("names the host's close-out after the end and opens the minutes confirm from the strip", async () => {
    const { adapter } = open("m1", { extra: MINUTES_ON });
    const row = await strip();
    expect(await within(row).findByText("9 việc chờ giao")).toBeInTheDocument();
    expect(await within(row).findByText(/Biên bản đang là bản nháp/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Rà và giao 9 việc" })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Phần của cuộc họp" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      expect.stringContaining("Tổng quan"),
      expect.stringContaining("Lời thoại"),
      expect.stringContaining("Biên bản"),
    ]);
    fireEvent.click(await within(row).findByRole("button", { name: "Chốt biên bản" }));
    expect(adapter.replace).toHaveBeenCalledWith(`${adapter.pathname}?tab=minutes&finalize=1`);
  });

  it("draws no Lời thoại tab and says so under the title when the scribe was off and heard nothing", async () => {
    const m1 = fixtureMeeting("m1");
    const base = `/api/v1/meetings/${m1.id}`;
    open("m1", { extra: { ...MINUTES_ON, [base]: { meeting: { ...m1, scribe_enabled: false } }, [`${base}/transcript`]: { segments: [] } } });
    expect(await screen.findByText("Cuộc họp không bật Thư ký UNI")).toBeInTheDocument();
    const tabs = await screen.findByRole("tablist", { name: "Phần của cuộc họp" });
    await waitFor(() =>
      expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
        expect.stringContaining("Tổng quan"),
        expect.stringContaining("Biên bản"),
      ]),
    );
  });

  it("tells a member their own items and who will assign the rest", async () => {
    open("m1", { viewer: "minh", extra: MINUTES_ON });
    const row = await strip();
    expect(await within(row).findByText(/^Bạn có \d+ việc từ cuộc họp này$/)).toBeInTheDocument();
    expect(row).toHaveTextContent(/chờ Lan Phạm hoặc Hà Vũ giao/);
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives an outsider one lock line, no tabs, and never asks for the AI content", async () => {
    open("m1Outsider");
    const row = await strip();
    expect(await within(row).findByText("Tóm tắt, lời thoại và Hỏi UNI chỉ dành cho người dự họp.")).toBeInTheDocument();
    expect(row).toHaveAccessibleName("Quyền xem của bạn");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(expect.stringMatching(/\/action-items$/)));
    const asked = requestMock.mock.calls.map(([p]) => String(p));
    expect(asked.some((p) => /\/(summary|transcript)/.test(p))).toBe(false);
  });

  it("shows an outsider the notes read-only, under what was handed out", async () => {
    open("m1Outsider");
    expect(await screen.findByText("Khóa tính năng SaoMai POS 3.0 ngày 30/10; kiểm thử tải xong trước 5/11.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /ghi chú/i })).not.toBeInTheDocument();
  });
});

describe("MeetingDetailView › header actions", () => {
  it("confirms a cancel with a toast before leaving", async () => {
    const success = vi.spyOn(toast, "success");
    const { onDeleted } = open("m3");
    fireEvent.click(await screen.findByRole("button", { name: /^Thao tác khác:/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hủy cuộc họp" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hủy cuộc họp" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith("Đã hủy cuộc họp");
  });

  it("says a failed cancel under the header, once, instead of a toast behind the dialog", async () => {
    const id = fixtureMeeting("m3").id;
    open("m3", {
      extra: {},
    });
    const routed = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, opts?: { method?: string }) =>
      String(path) === `/api/v1/meetings/${id}/cancel` && opts?.method === "POST"
        ? Promise.reject(new ApiError("Cuộc họp đã đổi trạng thái", "conflict", 409))
        : routed(path, opts),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Thao tác khác:/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hủy cuộc họp" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hủy cuộc họp" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("offers history to everyone, and edit and cancel only to the host", async () => {
    open("m3", { viewer: "minh" });
    fireEvent.click(await screen.findByRole("button", { name: /^Thao tác khác:/ }));
    expect(await screen.findByRole("menuitem", { name: "Lịch sử thao tác" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Sửa cuộc họp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Hủy cuộc họp" })).not.toBeInTheDocument();
  });
});

describe("MeetingDetailView › tabs", () => {
  it("opens the tab a deep link names and keeps it once the param is used", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const adapter = nav("section=transcript");
    open("m1", { adapter, extra: MINUTES_ON });
    const tab = await screen.findByRole("tab", { name: /Lời thoại/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith(`${adapter.pathname}?tab=transcript`));
  });

  it("switches tabs through the URL", async () => {
    const adapter = nav();
    open("m1", { adapter, extra: MINUTES_ON });
    fireEvent.click(await screen.findByRole("tab", { name: /Biên bản/ }));
    expect(adapter.replace).toHaveBeenCalledWith(`${adapter.pathname}?tab=minutes`);
  });

  it("draws no Biên bản tab before there are minutes; the host opens it from the rail to create them", async () => {
    const adapter = nav();
    const m1 = fixtureMeeting("m1");
    open("m1", { adapter, extra: { ...MINUTES_ON, [`/api/v1/meetings/${m1.id}/minutes`]: { minutes: null } } });
    const tabs = await screen.findByRole("tablist", { name: "Phần của cuộc họp" });
    expect(within(tabs).queryByRole("tab", { name: /Biên bản/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^Biên bản: Chưa có/ }));
    expect(adapter.replace).toHaveBeenCalledWith(`${adapter.pathname}?tab=minutes`);
  });

  it("labels the live tabs and counts the notes", async () => {
    open("m4");
    const tabs = await screen.findByRole("tablist", { name: "Phần của cuộc họp" });
    expect(await within(tabs).findByRole("tab", { name: /Ghi chú chung/ })).toHaveAttribute("aria-selected", "true");
    expect(demo.meetings.m4.notes.length).toBeGreaterThan(0);
    expect(await within(tabs).findByText(String(demo.meetings.m4.notes.length))).toBeInTheDocument();
  });
});
