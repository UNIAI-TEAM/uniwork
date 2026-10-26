import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import type { MeetingFeedEntry } from "@uniwork/core/meetings/feed";
import { requestMock, wrap } from "../../test/api-mock";
import { MeetingFeedList } from "./feed-list";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/members")
      ? Promise.resolve({
          members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
        })
      : Promise.resolve({}),
  );
});

// Local wall-clock instants, so the HH:mm the row prints does not depend on the test machine's zone.
const at = (h: number, m: number) => new Date(2026, 9, 26, h, m).toISOString();

const item = (id: string, over: Partial<MeetingActionItem> = {}): MeetingActionItem =>
  ({ id, title: `Việc ${id}`, status: "PENDING", source: "LIVE", evidence: [], ...over }) as MeetingActionItem;

const task = (it: MeetingActionItem, time: string, segmentId: string | null = null): MeetingFeedEntry => ({
  id: `task:${it.id}`,
  kind: "task",
  text: it.title,
  at: time,
  segmentId,
  actionItem: it,
});

const entries: MeetingFeedEntry[] = [
  // 2026-10-30 is a Friday.
  task(item("a1", { title: "Gửi bản sửa lỗi QR", suggested_assignee_id: "u-mai", suggested_due_date: "2026-10-30" }), at(10, 41), "s2"),
  { id: "decision:0", kind: "decision", text: "Lùi ngày ra mắt", at: at(10, 38), segmentId: null },
  { id: "question:0", kind: "question", text: "Đào tạo online hay tại chỗ?", at: at(10, 35), segmentId: null },
  {
    id: "note:n1",
    kind: "note",
    text: "Mời đại diện cửa hàng Q7",
    at: at(10, 30),
    segmentId: null,
    note: { id: "n1", meeting_id: "m1", author_id: "u-tuan", body: "Mời đại diện cửa hàng Q7", display_name: "Tuấn Đỗ" },
  },
  task(item("a2", { title: "Cập nhật kế hoạch", owner_text: "chị Hà" }), at(10, 29)),
  {
    id: "recording:r1",
    kind: "recording",
    text: "",
    at: at(10, 20),
    segmentId: null,
    recording: { id: "r1", meeting_id: "m1", status: "COMPLETE" },
  },
];

function setup(over: Partial<Parameters<typeof MeetingFeedList>[0]> = {}) {
  const props = {
    entries,
    unseen: new Set<string>(),
    canClerk: false,
    workspaceId: "w1",
    meetingId: "m1",
    onJumpToSegment: vi.fn(),
    onEditItem: vi.fn(),
    ...over,
  };
  render(wrap(<MeetingFeedList {...props} />));
  const rows = within(screen.getByRole("list", { name: "Diễn biến cuộc họp" })).getAllByRole("listitem");
  return { props, rows };
}

describe("MeetingFeedList", () => {
  it("lists the entries in the order given, each with its kind mark", () => {
    const { rows } = setup();
    expect(rows.map((r) => within(r).getByRole("img").getAttribute("aria-label"))).toEqual([
      "Việc cần làm",
      "Quyết định",
      "Câu hỏi còn mở",
      "Ghi chú",
      "Việc cần làm",
      "Bản ghi",
    ]);
    expect(rows[0]).toHaveTextContent("Gửi bản sửa lỗi QR");
    expect(rows[1]).toHaveTextContent("Lùi ngày ra mắt");
  });

  it("names who has a task and when it is due, else what was said of the owner", async () => {
    const { rows } = setup();
    expect(await within(rows[0]!).findByText("Mai Anh")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Thứ Sáu");
    expect(rows[4]).toHaveTextContent("chị Hà");
  });

  it("tags an open question and names a note's author", () => {
    const { rows } = setup();
    expect(rows[2]).toHaveTextContent("Chưa chốt");
    expect(rows[3]).toHaveTextContent("Tuấn Đỗ");
  });

  it("jumps to the transcript line from the time of an entry that rests on one", () => {
    const { rows, props } = setup();
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Xem câu nói lúc 10:41" }));
    expect(props.onJumpToSegment).toHaveBeenCalledWith("s2");
    // No line, no button: the time is plain text.
    expect(within(rows[1]!).queryByRole("button")).toBeNull();
    expect(rows[1]).toHaveTextContent("10:38");
  });

  it("marks the action items the viewer has not seen yet as new", () => {
    const { rows } = setup({ unseen: new Set(["a1"]) });
    expect(within(rows[0]!).getByRole("img", { name: "Mới" })).toBeInTheDocument();
    expect(within(rows[4]!).queryByRole("img", { name: "Mới" })).toBeNull();
  });

  it("offers a clerk, and only a clerk, a due date for a pending task that has none", () => {
    const attendee = setup();
    expect(within(attendee.rows[4]!).queryByRole("button", { name: "+ Hạn" })).toBeNull();
  });

  it("opens the task editor from + Due for a clerk", () => {
    const { rows, props } = setup({ canClerk: true });
    expect(within(rows[0]!).queryByRole("button", { name: "+ Hạn" })).toBeNull();
    fireEvent.click(within(rows[4]!).getByRole("button", { name: "+ Hạn" }));
    expect(props.onEditItem).toHaveBeenCalledWith("a2");
  });

  it("shows a converted item's task as it is now, not what was said or suggested", async () => {
    const said = { owner_text: "anh Tuấn", due_text: "thứ Sáu", suggested_assignee_id: "u-tuan", suggested_due_date: "2026-10-30" };
    const { rows } = setup({
      canClerk: true,
      entries: [
        // 2026-11-02 is a Monday.
        task(item("c1", { ...said, status: "CONVERTED", task: { id: "t1", title: "Việc c1", assignee_id: "u-mai", due_date: "2026-11-02" } } as Partial<MeetingActionItem>), at(10, 50)),
        task(item("c2", { ...said, status: "CONVERTED", task: { id: "t2", title: "Việc c2", assignee_id: null, due_date: null } } as Partial<MeetingActionItem>), at(10, 49)),
      ],
    });
    expect(await within(rows[0]!).findByText("Mai Anh")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Thứ Hai");
    expect(rows[0]).not.toHaveTextContent("thứ Sáu");
    expect(rows[0]).not.toHaveTextContent("anh Tuấn");
    // Unassigned and undated: no owner, no due chip, and no "+ Due" since the item is no longer pending.
    expect(rows[1]).toHaveTextContent(/^Việc c210:49$/);
    expect(within(rows[1]!).queryByRole("button", { name: "+ Hạn" })).toBeNull();
  });

  it("plays a finished recording in the recording dialog", async () => {
    const { rows } = setup();
    fireEvent.click(within(rows[5]!).getByRole("button", { name: "Phát bản ghi" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
