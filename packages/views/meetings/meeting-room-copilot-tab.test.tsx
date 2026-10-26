import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomCopilotTab } from "./meeting-room-copilot-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

beforeAll(() => {
  initI18n();
});

// Local wall-clock instants, so the HH:mm the feed prints does not depend on the test machine's zone.
const at = (h: number, m: number) => new Date(2026, 8, 22, h, m).toISOString();

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "- Chốt lịch phát hành",
  decisions: [{ text: "Phát hành thứ Sáu", evidence: [{ kind: "segment", id: "t1" }] }],
  created_at: "2026-09-22T07:05:00Z",
};

const segment = { id: "t1", meeting_id: "m1", text: "Chốt phát hành thứ Sáu nhé", spoken_at: at(9, 5), speaker_name: "Lan" };

const actionItems = {
  items: [
    { id: "a0", source: "AI", title: "Viết ghi chú phát hành", status: "PENDING", created_at: at(9, 10) },
    { id: "a1", source: "AI", title: "Báo khách hàng", status: "PENDING", created_at: at(9, 11) },
  ],
  counts: { pending: 2, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 },
};

const project = {
  id: "p1", organization_id: "o1", workspace_id: "w1", title: "Ra mắt Q4", description: "", status: "in_progress",
  priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

const carriedOver = {
  items: [
    {
      action_item_id: "c1",
      meeting: { id: "m0", title: "Giao ban tuần trước", started_at: "2026-10-13T02:00:00Z" },
      task: { id: "t7", title: "Gửi báo giá", status: "todo", done: false, overdue: false, assignee_id: null, due_date: null },
    },
  ],
  total: 1,
};

type Respond = () => Promise<unknown>;
const pending: Respond = () => new Promise(() => {});
const failed: Respond = () => Promise.reject(new ApiError("boom", "internal", 500));
const ok = (v: unknown): Respond => () => Promise.resolve(v);

/** The room's reads; each can be swapped for a test. */
function serve(over: Partial<Record<"summary" | "transcript" | "notes" | "items" | "recordings" | "motions" | "carried", Respond>> = {}) {
  const r = {
    summary: ok({ summary }),
    transcript: ok({ segments: [] }),
    notes: ok({ notes: [] }),
    items: ok(actionItems),
    recordings: ok({ recordings: [] }),
    motions: ok({ motions: [] }),
    carried: ok(carriedOver),
    ...over,
  };
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/action-items/convert") && init?.method === "POST") {
      return Promise.resolve({ links: [{ action_item_id: "a0", task_id: "t1" }] });
    }
    if (p.endsWith("/summary") && init?.method === "POST") return new Promise(() => {});
    if (p.endsWith("/summary")) return r.summary();
    if (p.endsWith("/transcript")) return r.transcript();
    if (p.endsWith("/notes")) return r.notes();
    if (p.endsWith("/action-items")) return r.items();
    if (p.endsWith("/recordings")) return r.recordings();
    if (p.endsWith("/motions")) return r.motions();
    if (p.endsWith("/carried-over-items")) return r.carried();
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/ai/capabilities")) return Promise.resolve({ enabled: true, ask_uni: true });
    if (p.includes("/projects/p1")) return Promise.resolve({ project });
    if (p.endsWith("/chat")) return Promise.resolve({ messages: [] });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, focusByConversation: {}, conversationByMeeting: {} });
  requestMock.mockReset();
  serve();
});

type Props = Partial<Parameters<typeof MeetingRoomCopilotTab>[0]>;
const renderTab = (props: Props = {}) =>
  render(wrapWithNav(<MeetingRoomCopilotTab workspaceId="w1" meetingId="m1" canClerk {...props} />));

const view = (name: "Tổng hợp" | "Lời thoại") => screen.getByRole("radio", { name });
const chip = (name: RegExp) => screen.getByRole("button", { name });
const feedList = () => screen.queryByRole("list", { name: "Diễn biến cuộc họp" });
const findFeed = () => screen.findByRole("list", { name: "Diễn biến cuộc họp" });
const calls = (suffix: string) => requestMock.mock.calls.filter(([p]) => String(p).endsWith(suffix));

describe("MeetingRoomCopilotTab › shell", () => {
  it("opens on Highlights: the summary, the kind chips and the feed, with the composer pinned under them", async () => {
    renderTab();
    expect(view("Tổng hợp")).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByRole("heading", { name: "Tóm tắt đến giờ" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Lọc theo loại" })).toBeInTheDocument();
    expect(await within(await findFeed()).findByText("Phát hành thứ Sáu")).toBeInTheDocument();
    const scroll = screen.getByTestId("meeting-copilot-scroll");
    expect(scroll).not.toContainElement(screen.getByTestId("meeting-composer"));
  });

  it("switching to the transcript hides the feed and shows the transcript; the composer stays in both", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    await findFeed();
    expect(screen.getByTestId("meeting-composer")).toBeInTheDocument();

    fireEvent.click(view("Lời thoại"));
    expect(view("Lời thoại")).toHaveAttribute("aria-checked", "true");
    expect(feedList()).not.toBeInTheDocument();
    expect(await screen.findByTestId("meeting-room-transcript")).toHaveTextContent("Chốt phát hành thứ Sáu nhé");
    expect(screen.getByTestId("meeting-composer")).toBeInTheDocument();
  });

  it("says in the status row what the scribe is doing", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab({ scribeState: "on" });
    expect(await screen.findByText("Đang ghi")).toBeInTheDocument();
  });

  it("offers the transcript search in the status row only in the transcript view", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    expect(screen.queryByRole("button", { name: "Tìm trong lời thoại" })).not.toBeInTheDocument();
    fireEvent.click(view("Lời thoại"));
    const search = screen.getByRole("button", { name: "Tìm trong lời thoại" });
    expect(search).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(search);
    expect(search).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("textbox", { name: "Tìm trong lời thoại" })).toBeInTheDocument();
  });

  it("gives someone without a workspace (a guest) no composer, no Ask and no catch-up", async () => {
    renderTab({ workspaceId: undefined, lateMinutes: 23 });
    await screen.findByRole("heading", { name: "Tóm tắt đến giờ" });
    expect(screen.queryByTestId("meeting-composer")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Hỏi" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-catch-up-card")).not.toBeInTheDocument();
  });

  it("offers the catch-up card at the top of the feed to a late member only", async () => {
    const { unmount } = renderTab({ lateMinutes: 23 });
    const card = await screen.findByTestId("meeting-catch-up-card");
    expect(card.compareDocumentPosition(await screen.findByRole("heading", { name: "Tóm tắt đến giờ" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    renderTab({ lateMinutes: null });
    await screen.findByRole("heading", { name: "Tóm tắt đến giờ" });
    expect(screen.queryByTestId("meeting-catch-up-card")).not.toBeInTheDocument();
  });

  it("puts the Ask UNI exchange at the end of the feed", async () => {
    serve();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: unknown) =>
      String(path).endsWith("/ai/ask")
        ? Promise.resolve({ conversation_id: "c1", message: { id: "x", role: "assistant", content: "Thứ Sáu.", citations: [] } })
        : base(path, init),
    );
    renderTab();
    await findFeed();
    fireEvent.click(await screen.findByRole("button", { name: "Đã chốt gì?" }));
    const answer = await screen.findByRole("article", { name: "Hỏi UNI" });
    expect(screen.getByTestId("meeting-copilot-scroll")).toContainElement(answer);
    expect(feedList()!.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("MeetingRoomCopilotTab › wiring between the views", () => {
  const original = Element.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("a feed time takes the reader to that line in the transcript", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Xem câu nói lúc 09:05" }));
    expect(view("Lời thoại")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).dataset.segmentId).toBe("t1");
  });

  it("a chip under a transcript line opens the feed filtered to that kind", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    await findFeed();
    fireEvent.click(view("Lời thoại"));
    fireEvent.click(await screen.findByRole("button", { name: /Đã thành quyết định/ }));
    expect(view("Tổng hợp")).toHaveAttribute("aria-checked", "true");
    expect(chip(/^Quyết định, 1$/)).toHaveAttribute("aria-pressed", "true");
    expect(within(feedList()!).queryByText("Viết ghi chú phát hành")).not.toBeInTheDocument();
  });

  it("a clerk's “+ Hạn” in the feed opens that item's edit composer in the task list", async () => {
    renderTab();
    const feed = await findFeed();
    const add = await within(feed).findAllByRole("button", { name: "+ Hạn" });
    fireEvent.click(add.at(-1)!);
    const dialog = await screen.findByRole("dialog");
    // The dialog is modal: what is behind it is out of the accessibility tree.
    expect(screen.getByRole("button", { name: /^Việc cần làm, 2$/, hidden: true })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Tiêu đề issue" })).toHaveValue("Viết ghi chú phát hành"));
  });

  it("the empty state's carried-over card opens the task list with that group open", async () => {
    serve({ summary: ok({ summary: null }), items: ok({ items: [], counts: {} }) });
    renderTab({ projectId: "p1" });
    fireEvent.click(await screen.findByRole("button", { name: "1 việc còn mở, Từ lần họp trước" }));
    expect(chip(/^Việc cần làm, 0$/)).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Gửi báo giá")).toBeInTheDocument();
  });

  it("hides the composer while the clerk has items ticked, under the selection bar", async () => {
    renderTab();
    fireEvent.click(await waitFor(() => chip(/^Việc cần làm, 2$/)));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Báo khách hàng" }));
    expect(screen.getByRole("region", { name: "Việc đã chọn" })).toBeInTheDocument();
    expect(screen.getByTestId("meeting-composer")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.getByTestId("meeting-composer")).toBeVisible();
  });

  it("tells the room which view and filter are on screen, and the default once it unmounts", async () => {
    const onViewChange = vi.fn();
    const { unmount } = renderTab({ onViewChange });
    expect(onViewChange).toHaveBeenLastCalledWith("feed", "all");
    fireEvent.click(await waitFor(() => chip(/^Việc cần làm, 2$/)));
    expect(onViewChange).toHaveBeenLastCalledWith("feed", "task");
    fireEvent.click(view("Lời thoại"));
    expect(onViewChange).toHaveBeenLastCalledWith("transcript", "task");
    unmount();
    expect(onViewChange).toHaveBeenLastCalledWith("feed", "all");
  });

  it("marks the items the viewer has not seen yet as new in the feed", async () => {
    renderTab({ unseenItems: new Set(["a1"]) });
    const row = (await within(await findFeed()).findByText("Báo khách hàng")).closest("li")!;
    expect(within(row).getByRole("img", { name: "Mới" })).toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab › summary", () => {
  it("labels the copy button as an action, not as its result", async () => {
    renderTab();
    expect(await screen.findByRole("button", { name: "Sao chép tóm tắt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đã sao chép" })).not.toBeInTheDocument();
  });

  it("says what the summary was made from", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    const card = (await screen.findByRole("heading", { name: "Tóm tắt đến giờ" })).closest("section")!;
    await waitFor(() => expect(card).toHaveTextContent(/lời thoại/i));
    expect(card).not.toHaveTextContent(/ghi chú|tin nhắn/);
  });

  it("keeps a refused summary run in the card, once, with no retry a plan refusal cannot use", async () => {
    serve({ summary: ok({ summary: null }), transcript: ok({ segments: [segment] }) });
    const served = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      String(path).endsWith("/summary") && init?.method === "POST"
        ? Promise.reject(new ApiError("x", "ai_quota_exceeded", 402))
        : served(path, init),
    );
    renderTab();
    const create = await screen.findByRole("button", { name: "Tạo" });
    await waitFor(() => expect(create).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(create);
    const scroll = screen.getByTestId("meeting-copilot-scroll");
    await waitFor(() => expect(scroll).toHaveTextContent("Tổ chức đã dùng hết hạn mức AI của tháng."));
    expect(within(scroll).getAllByText(/Tổ chức đã dùng hết hạn mức AI của tháng/)).toHaveLength(1);
    expect(within(scroll).queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("asks before replacing the summary", async () => {
    serve({ transcript: ok({ segments: [segment] }) });
    renderTab();
    const update = await screen.findByRole("button", { name: "Cập nhật tóm tắt" });
    await waitFor(() => expect(update).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(update);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));
  });

  it("counts a closed vote as something to summarise, like the server", async () => {
    const closed = {
      id: "mo1", title: "Thông qua kế hoạch quý IV", description: "", position: 1, ballot_mode: "PUBLIC",
      threshold: "MAJORITY", base: "PRESENT", status: "CLOSED", roll_size: 4, total_members: 5, cast_count: 4,
      closed_at: "2026-09-22T07:00:00Z", result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
    };
    serve({ summary: ok({ summary: null }), motions: ok({ motions: [closed] }) });
    renderTab();
    const create = await screen.findByRole("button", { name: "Tạo" });
    await waitFor(() => expect(create).not.toHaveAttribute("aria-disabled"));
  });

  it("no longer shows a locked coming-soon Q&A row, nor the live recording state (the stage header has it)", async () => {
    serve({ recordings: ok({ recordings: [{ id: "r1", meeting_id: "m1", status: "ACTIVE", started_at: "2026-09-22T07:00:00Z" }] }) });
    renderTab();
    await screen.findByRole("button", { name: "Sao chép tóm tắt" });
    expect(screen.queryByText("Sắp có")).not.toBeInTheDocument();
    expect(screen.queryByText("Đang ghi hình trực tiếp")).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab › loading and empty", () => {
  it("shows a skeleton while the meeting's content loads, never the empty state", () => {
    serve({ summary: pending });
    renderTab();
    expect(within(screen.getByTestId("meeting-copilot-scroll")).getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
  });

  it("shows the empty state once everything arrived empty, saying there is no transcript without a scribe", async () => {
    serve({ summary: ok({ summary: null }), items: ok({ items: [], counts: {} }) });
    renderTab();
    expect(await screen.findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
    expect(feedList()).not.toBeInTheDocument();
  });

  it("offers a retry when the summary fails", async () => {
    serve({ summary: failed, items: ok({ items: [], counts: {} }) });
    renderTab();
    expect(await screen.findByText("Không tải được tóm tắt.")).toBeInTheDocument();
    serve({ summary: ok({ summary: null }), items: ok({ items: [], counts: {} }) });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có bản ghi lời thoại/)).toBeInTheDocument();
  });

  it("names a note's author in words, never by a raw id", async () => {
    serve({ notes: ok({ notes: [{ id: "n1", meeting_id: "m1", author_id: "01JA0000000000000000000000", body: "Gửi lịch" }] }) });
    renderTab();
    expect(await screen.findByText("Gửi lịch")).toBeInTheDocument();
    expect(screen.queryByText("01JA0000000000000000000000")).not.toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab › transcript view", () => {
  const seg = (id: string, min: number) => ({ id, meeting_id: "m1", text: `câu ${id}`, spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`, speaker_name: "Lan" });

  it("shows a skeleton, not the empty copy, while the transcript loads", () => {
    serve({ transcript: pending });
    renderTab();
    fireEvent.click(view("Lời thoại"));
    expect(screen.getAllByRole("status").some((s) => within(s).queryByText("Đang tải…"))).toBe(true);
    expect(screen.queryByText(/Chưa có bản ghi lời thoại/)).not.toBeInTheDocument();
  });

  it("offers a retry when the transcript fails", async () => {
    serve({ transcript: failed });
    renderTab();
    fireEvent.click(view("Lời thoại"));
    expect(await screen.findByText("Không tải được bản ghi lời thoại.")).toBeInTheDocument();
  });

  it("reads the earlier transcript on request, not only the newest page", async () => {
    serve();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [seg("t2", 20)], older_cursor: "o2", after_cursor: "x" });
      if (p.endsWith("/transcript?before=o2")) return Promise.resolve({ segments: [seg("t1", 10)] });
      return base(path, init);
    });
    renderTab();
    fireEvent.click(view("Lời thoại"));
    const list = await screen.findByTestId("meeting-room-transcript");
    await waitFor(() => expect(within(list).getByText("câu t2")).toBeInTheDocument());
    fireEvent.click(within(list).getByRole("button", { name: "Tải lời thoại trước đó" }));
    await waitFor(() => expect(within(list).getByText("câu t1")).toBeInTheDocument());
  });

  it("does not ask for captions while the AI scribe is already transcribing", async () => {
    const { unmount } = renderTab({ scribeOn: true });
    fireEvent.click(view("Lời thoại"));
    expect(await screen.findByText(/Thư ký UNI đang nghe, câu đầu tiên/)).toBeInTheDocument();
    expect(screen.queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    unmount();
    renderTab();
    fireEvent.click(view("Lời thoại"));
    expect(await screen.findByText(/Bật phụ đề/)).toBeInTheDocument();
  });
});

describe("MeetingRoomCopilotTab › tasks, as on the detail page", () => {
  function posted(): { items?: Record<string, unknown>[] } {
    const call = requestMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/action-items/convert") && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    return ((call?.[1] as { body?: unknown } | undefined)?.body ?? {}) as { items?: Record<string, unknown>[] };
  }
  const openTasks = async () => fireEvent.click(await waitFor(() => chip(/^Việc cần làm, 2$/)));

  it("gives the new tasks the meeting's project", async () => {
    renderTab({ projectId: "p1" });
    await openTasks();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Viết ghi chú phát hành" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p1"))).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: "Giao 1 việc" }));
    await waitFor(() => expect(posted().items).toHaveLength(1));
    expect(posted()).toMatchObject({ items: [{ action_item_id: "a0", project_id: "p1" }], locale: "vi" });
  });

  it("does not dress up the picked checkboxes as task progress", async () => {
    renderTab();
    await openTasks();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Báo khách hàng" }));
    expect(screen.queryByText("Tiến độ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hoàn thành \d+ \/ \d+ việc/)).not.toBeInTheDocument();
  });

  it("folds the tasks earlier meetings of the project left open into one group", async () => {
    renderTab({ projectId: "p1" });
    await openTasks();
    const toggle = await screen.findByRole("button", { name: "Từ lần họp trước · 1" });
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByText("Gửi báo giá")).toBeInTheDocument();
  });

  it("offers the carried-over group without a project too: a series carries items over", async () => {
    renderTab();
    await openTasks();
    expect(await screen.findByRole("button", { name: "Từ lần họp trước · 1" })).toBeInTheDocument();
  });

  it("keeps the clerk's ticks while they look at the transcript", async () => {
    renderTab();
    await openTasks();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Báo khách hàng" }));
    fireEvent.click(view("Lời thoại"));
    expect(screen.queryByRole("checkbox", { name: "Báo khách hàng" })).not.toBeInTheDocument();
    fireEvent.click(view("Tổng hợp"));
    expect(await screen.findByRole("checkbox", { name: "Báo khách hàng" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Giao 1 việc" })).toBeInTheDocument();
  });

  it("shows a member who is not a clerk the items read-only, in the feed", async () => {
    renderTab({ canClerk: false });
    await openTasks();
    expect(await within(await findFeed()).findByText("Viết ghi chú phát hành")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giao|\+ Hạn/ })).not.toBeInTheDocument();
  });

  it("shows no items without a workspace (items are for members only)", async () => {
    renderTab({ workspaceId: undefined });
    await screen.findByRole("heading", { name: "Tóm tắt đến giờ" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(calls("/action-items")).toHaveLength(0);
  });
});
