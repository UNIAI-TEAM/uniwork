import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { WSClient } from "@uniwork/core/api/ws-client";
import type { WSMessage } from "@uniwork/core/api";
import { setSessionUser } from "@uniwork/core/auth";
import { useRealtimeSync } from "@uniwork/core/realtime";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { clock } from "../format";
import {
  DEMO_NOW,
  demo,
  demoUser,
  demoWorkspace,
  detailValue,
  fixtureMeeting,
  routeMeeting,
  type DemoUserKey,
  type MeetingFixtureKey,
} from "../test-fixtures";
import { LiveNotesTab } from "./live-notes-tab";
import { NotesFeed } from "./notes-feed";

const M4 = fixtureMeeting("m4");
const NOTES = demo.meetings.m4.notes;

function renderSlot(
  key: MeetingFixtureKey,
  ui: ReactElement,
  {
    who = "lan",
    value,
    notes,
  }: { who?: DemoUserKey; value?: Partial<DetailContextValue>; notes?: () => Promise<unknown> } = {},
) {
  routeMeeting(key, { viewer: who });
  if (notes) notesRoute(notes);
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue(key, { user: who, ...value })}>{ui}</DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

/** Answers the notes GET with `notes()` and records POSTs; everything else as the fixture. */
function notesRoute(notes: () => Promise<unknown>) {
  const fixture = requestMock.getMockImplementation()!;
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    if (String(path).endsWith("/notes") && opts?.method === "POST") return Promise.resolve({ note: {} });
    if (String(path).endsWith("/notes")) return notes();
    return fixture(path, opts);
  });
}

const postedNote = () =>
  requestMock.mock.calls.find(
    ([path, opts]) => String(path).endsWith("/notes") && (opts as { method?: string })?.method === "POST",
  );

beforeEach(() => {
  requestMock.mockReset();
});

describe("LiveNotesTab", () => {
  it("shows who is speaking, the notes with each author once, the composer and the AI line", async () => {
    const setTab = vi.fn();
    renderSlot("m4", <LiveNotesTab />, { value: { tabs: { list: ["notes", "transcript"], current: "notes", set: setTab } } });

    const ticker = await screen.findByRole("button", { name: /^Đang nói: Lan Phạm lúc .*\. Mở lời thoại$/ });
    expect(within(ticker).getByText("Đang nói")).toHaveClass("text-success");
    fireEvent.click(ticker);
    expect(setTab).toHaveBeenCalledWith("transcript");

    expect(await screen.findByText(NOTES[0]!.body)).toBeInTheDocument();
    // Hà wrote the first two: her name heads the first only.
    expect(screen.getAllByText("Hà Vũ")).toHaveLength(1);
    expect(screen.getAllByText("Lan Phạm").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(clock(NOTES[1]!.created_at))).toHaveClass("font-mono");

    expect(screen.getByRole("textbox", { name: "Thêm ghi chú chung" })).toHaveAttribute(
      "placeholder",
      "Ví dụ: Minh cập nhật đối tác ví lúc 21:30",
    );
    expect(await screen.findByText("Đang nghe · 15 câu · tóm tắt và việc cần làm có sau khi kết thúc")).toBeInTheDocument();
  });

  it("calls an old line the last one, in muted ink", async () => {
    renderSlot("m4", <LiveNotesTab />, { value: { now: DEMO_NOW + 60 * 60_000, displayStatus: "OVERTIME" } });
    const ticker = await screen.findByRole("button", { name: /^Câu gần nhất: Lan Phạm/ });
    expect(within(ticker).getByText("Câu gần nhất")).toHaveClass("text-muted-foreground");
  });

  it("focuses the composer on load for the secretary only", async () => {
    const { unmount } = renderSlot("m4", <LiveNotesTab />, { who: "ha" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Thêm ghi chú chung" })).toHaveFocus());
    unmount();
    renderSlot("m4", <LiveNotesTab />, { who: "lan" });
    expect(screen.getByRole("textbox", { name: "Thêm ghi chú chung" })).not.toHaveFocus();
  });

  it("leaves the secretary's composer unfocused on a phone, where focus opens the keyboard", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...real(query), matches: query === "(pointer: coarse)" })) as typeof window.matchMedia;
    try {
      renderSlot("m4", <LiveNotesTab />, { who: "ha" });
      const box = await screen.findByRole("textbox", { name: "Thêm ghi chú chung" });
      await new Promise((r) => setTimeout(r, 50));
      expect(box).not.toHaveFocus();
    } finally {
      window.matchMedia = real;
    }
  });
});

describe("NotesFeed", () => {
  it("adds a note on Enter, keeps Shift+Enter for a new line, and clears the field", async () => {
    renderSlot("m4", <NotesFeed variant="live" />);
    const box = await screen.findByRole("textbox", { name: "Thêm ghi chú chung" });
    expect(box).toHaveAttribute("enterkeyhint", "send");
    fireEvent.change(box, { target: { value: "Dòng một" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(postedNote()).toBeUndefined();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(postedNote()).toBeUndefined();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(postedNote()).toBeDefined());
    expect((postedNote()![1] as { body?: unknown }).body).toEqual({ body: "Dòng một" });
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("shows a skeleton while loading, then a retry when the notes fail", async () => {
    let fail = true;
    renderSlot("m4", <NotesFeed variant="live" />, {
      notes: () => (fail ? Promise.reject(new ApiError("boom", "internal", 500)) : Promise.resolve({ notes: NOTES })),
    });
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(await screen.findByText("Không tải được ghi chú.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(NOTES[0]!.body)).toBeInTheDocument();
  });

  it("before the meeting, says notes written ahead go into the minutes, with its own composer", async () => {
    renderSlot("m3", <NotesFeed variant="scheduled" />);
    expect(await screen.findByText("Chưa có ghi chú. Ghi chú viết trước sẽ nằm trong biên bản.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ghi chú" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Thêm ghi chú" })).toHaveAttribute("placeholder", "Viết ghi chú trước buổi họp");
    expect(screen.getByRole("button", { name: "Thêm biểu quyết" })).toBeInTheDocument();
  });

  it("gives a member no add-vote line", async () => {
    renderSlot("m3", <NotesFeed variant="scheduled" />, { who: "minh" });
    expect(await screen.findByRole("textbox", { name: "Thêm ghi chú" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm biểu quyết" })).toBeNull();
  });

  it("reads an ended meeting's notes with their count and no composer, and draws nothing when there are none", async () => {
    renderSlot("m1", <NotesFeed variant="overview" />);
    const section = await screen.findByRole("region", { name: "Ghi chú" });
    expect(within(section).getByText(String(demo.meetings.m1.notes.length))).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/khóa|chỉ còn để đọc/)).toBeNull();
  });

  it("hides the overview section when the meeting has no notes", async () => {
    const { container } = renderSlot("m1", <NotesFeed variant="overview" />, { notes: () => Promise.resolve({ notes: [] }) });
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/notes"))).toBe(true));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("gives an outsider no notes section", () => {
    const { container } = renderSlot("m1Outsider", <NotesFeed variant="overview" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a note someone else adds as soon as its note.created frame arrives", async () => {
    const handlers = new Set<(msg: WSMessage) => void>();
    const client = {
      onAny: (h: (msg: WSMessage) => void) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
      onReconnect: () => () => {},
    } as unknown as WSClient;
    function Realtime() {
      useRealtimeSync(client, demoWorkspace.id);
      return null;
    }
    let notes = NOTES.slice(0, 1);
    renderSlot(
      "m4",
      <>
        <Realtime />
        <NotesFeed variant="live" />
      </>,
      { notes: () => Promise.resolve({ notes }) },
    );
    expect(await screen.findByText(NOTES[0]!.body)).toBeInTheDocument();
    expect(screen.queryByText(NOTES[2]!.body)).toBeNull();

    notes = NOTES;
    handlers.forEach((h) =>
      h({ type: "note.created", payload: { meeting_id: M4.id, note_id: NOTES[2]!.id } } as unknown as WSMessage),
    );
    expect(await screen.findByText(NOTES[2]!.body, {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
