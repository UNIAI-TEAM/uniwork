import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demoUser, demoWorkspace, detailValue, routeMeeting } from "../test-fixtures";
import { TranscriptTab, TranscriptView } from "./transcript-tab";

beforeAll(() => {
  initI18n();
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  starts_at: "2026-09-22T02:00:00Z",
  ends_at: "2026-09-22T02:30:00Z",
  status: "ENDED",
  host_user_id: "u-host",
} as Meeting;

function respond(routes: Record<string, unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    // Matched without the query: an ended meeting reads its whole transcript (?order=asc&limit=…).
    const bare = p.split("?")[0] ?? p;
    for (const [suffix, body] of Object.entries(routes)) if (bare.endsWith(suffix)) return Promise.resolve(body);
    return Promise.resolve({});
  });
}

const view = (m: Meeting = meeting, canClerk = false, nav = fakeNav()) =>
  render(wrapWithNav(<TranscriptView workspaceId="w1" meeting={m} canClerk={canClerk} />, nav));

const seg = (id: string, text: string, min: number, extra: Record<string, unknown> = {}) => ({
  id,
  meeting_id: "m1",
  text,
  spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`,
  ...extra,
});

beforeEach(() => {
  requestMock.mockReset();
});

describe("TranscriptView (ported from the transcript panel)", () => {
  it("says an ended meeting has no transcript, without suggesting captions", async () => {
    respond({ "/transcript": { segments: [] } });
    view();
    expect(await screen.findByText("Cuộc họp này không có bản ghi lời thoại.")).toBeInTheDocument();
    expect(screen.queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says the recordings did not load instead of hiding them, and why a recording failed", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/recordings")) return Promise.reject(new Error("Failed to fetch"));
      if (p.includes("/transcript")) return Promise.resolve({ segments: [seg("t1", "Một", 10)] });
      return Promise.resolve({});
    });
    const { unmount } = view();
    expect(await screen.findByText("Không tải được bản ghi của cuộc họp.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    unmount();

    respond({
      "/transcript": { segments: [seg("t1", "Một", 10)] },
      "/recordings": { recordings: [{ id: "r1", meeting_id: "m1", status: "FAILED", started_at: "2026-09-22T02:00:00Z" }] },
    });
    view();
    expect(await screen.findByText("Không lưu được bản ghi này.")).toHaveClass("text-destructive");
  });

  it("points a live meeting with no transcript at the captions", async () => {
    respond({ "/transcript": { segments: [] } });
    view({ ...meeting, status: "IN_PROGRESS" }, true);
    expect(await screen.findByText(/Bật phụ đề trong phòng họp/)).toBeInTheDocument();
  });

  it("puts the upload in view for a clerk where transcription is available", async () => {
    respond({ "/transcript": { segments: [] }, "/meeting-capabilities": { transcription: true } });
    view(meeting, true);
    expect(await screen.findByText("Chưa có bản ghi lời thoại. Tải tệp ghi âm lên để UNI ghi lời.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải tệp ghi âm" }));
    expect(await screen.findByRole("dialog", { name: "Tải tệp ghi âm lên" })).toBeInTheDocument();
  });

  it("after a failed upload, offers one way back: the retry in the error box", async () => {
    respond({
      "/transcript": { segments: [] },
      "/meeting-capabilities": { transcription: true },
      "/transcriptions": {
        transcriptions: [
          { id: "t1", meeting_id: "m1", filename: "hop.m4a", status: "FAILED", error_code: "decode_failed", created_at: "2026-09-22T03:00:00Z" },
        ],
      },
    });
    view(meeting, true);
    expect(await screen.findByRole("button", { name: "Tải lại tệp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải tệp ghi âm" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tải tệp ghi âm lên để UNI ghi lời/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại tệp" }));
    expect(await screen.findByRole("dialog", { name: "Tải tệp ghi âm lên" })).toBeInTheDocument();
  });

  it("says an upload replaces the room's transcript, from the tab's ⋯ (UNI-1995 #11)", async () => {
    respond({
      "/transcript": { segments: [seg("t1", "Một", 10, { source: "AGENT" })] },
      "/meeting-capabilities": { transcription: true },
      // The ⋯ is drawn only for a meeting with a recording or an upload.
      "/recordings": { recordings: [{ id: "r1", meeting_id: "m1", status: "COMPLETE", started_at: "2026-09-22T02:00:00Z" }] },
    });
    view(meeting, true);
    await screen.findByText("Một");
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác khác với lời thoại" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tải tệp ghi âm" }));
    const dialog = await screen.findByRole("dialog", { name: "Tải tệp ghi âm lên" });
    expect(within(dialog).getByText(/thay cho lời thoại đó/)).toBeInTheDocument();
  });

  it("offers no upload where the workspace cannot transcribe", async () => {
    respond({ "/transcript": { segments: [] }, "/meeting-capabilities": { transcription: false } });
    view(meeting, true);
    await screen.findByText("Cuộc họp này không có bản ghi lời thoại.");
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meeting-capabilities"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Tải tệp ghi âm" })).not.toBeInTheDocument();
  });

  it("names speakers in the reader's language, once per run", async () => {
    respond({
      "/transcript": {
        segments: [
          seg("t1", "Một", 10, { speaker_name: "x", speaker_label: "k:1:A", room_speaker: 2 }),
          seg("t2", "Hai", 11, { speaker_name: "x", speaker_label: "k:1:?" }),
          seg("t3", "Ba", 12, { speaker_name: "Chị Lan" }),
          seg("t4", "Bốn", 13, { speaker_name: "x", speaker_label: "upload:T1:A", room_speaker: 1 }),
          seg("t5", "Năm", 14, { speaker_name: "x", speaker_label: "upload:T1:A", room_speaker: 1 }),
        ],
      },
    });
    view(meeting, true);
    const list = await screen.findByTestId("meeting-transcript");
    expect(within(list).getByText("Hội trường · Người nói 2")).toBeInTheDocument();
    expect(within(list).getByText("Hội trường · Không rõ")).toBeInTheDocument();
    expect(within(list).getByText("Chị Lan")).toBeInTheDocument();
    // The second line of a run keeps the name for screen readers only.
    const names = within(list).getAllByText("Người nói 1");
    expect(names.map((n) => n.classList.contains("sr-only"))).toEqual([false, true]);
    expect(within(list).getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(5);
  });

  it("reads an ended meeting's whole transcript, page after page, in order (UNI-1995 #9)", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript?order=asc&limit=400")) return Promise.resolve({ segments: [seg("t1", "câu t1", 10)], newer_cursor: "n1" });
      if (p.endsWith("/transcript?from=n1&limit=400")) return Promise.resolve({ segments: [seg("t2", "câu t2", 20)] });
      return Promise.resolve({});
    });
    view();
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(within(list).getByText("câu t2")).toBeInTheDocument());
    expect(within(list).getAllByText(/^câu t/).map((n) => n.textContent)).toEqual(["câu t1", "câu t2"]);
    expect(within(list).queryByRole("button", { name: /Tải/ })).not.toBeInTheDocument();
  });

  it("searches every line, marks the hits and steps through them with n/m (UNI-1995 #14)", async () => {
    respond({
      "/transcript": {
        segments: [
          seg("t1", "Chốt ngân sách quý", 10, { speaker_name: "Lan" }),
          seg("t2", "Lịch demo thứ Sáu", 11, { speaker_name: "Hùng" }),
          seg("t3", "Ngan sach tang", 12, { speaker_name: "Hùng" }),
        ],
      },
    });
    view();
    const box = await screen.findByRole("searchbox", { name: "Tìm trong lời thoại" });
    fireEvent.change(box, { target: { value: "ngan sach" } });
    const list = screen.getByTestId("meeting-transcript");
    expect([...list.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["ngân sách", "Ngan sach"]);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(list.querySelector('mark[aria-current="true"]')).toHaveTextContent("ngân sách");
    fireEvent.click(screen.getByRole("button", { name: "Kết quả sau" }));
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(list.querySelector('mark[aria-current="true"]')).toHaveTextContent("Ngan sach");
    // Enter goes on (wrapping round), Shift+Enter back.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa tìm kiếm" }));
    expect(list.querySelector("mark")).toBeNull();
    expect(within(list).getByText("Lịch demo thứ Sáu")).toBeInTheDocument();
  });

  it("reads several words as a phrase when a line holds them together, else word by word (UNI-1995 #14)", async () => {
    respond({
      "/transcript": {
        segments: [
          seg("t1", "Gửi báo giá thứ Hai", 10, { speaker_name: "Lan" }),
          seg("t2", "Giá chốt rồi, báo sau", 11, { speaker_name: "Lan" }),
          seg("t3", "Báo cáo tuần", 12, { speaker_name: "Lan" }),
        ],
      },
    });
    view();
    const box = await screen.findByRole("searchbox", { name: "Tìm trong lời thoại" });
    const list = screen.getByTestId("meeting-transcript");
    const marked = () => [...list.querySelectorAll("mark")].map((m) => m.textContent);
    fireEvent.change(box, { target: { value: "bao gia" } });
    expect(marked()).toEqual(["báo giá"]);
    expect(screen.getByText("1/1")).toBeInTheDocument();
    // No line says "giá báo": each word may stand anywhere, and the count is the lines marked.
    fireEvent.change(box, { target: { value: "gia bao" } });
    expect(marked()).toEqual(["báo giá", "Giá", "báo"]);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "không có" } });
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByText("Không có câu nào khớp.")).toHaveAttribute("role", "status");
  });

  it("keeps one speaker's lines from their chip", async () => {
    respond({
      "/transcript": {
        segments: [
          seg("t1", "Một", 10, { speaker_name: "Lan Phạm", participant_id: "p1" }),
          seg("t2", "Hai", 11, { speaker_name: "Hà Vũ", participant_id: "p2" }),
          seg("t3", "Ba", 12, { speaker_name: "Lan Phạm", participant_id: "p1" }),
        ],
      },
    });
    view();
    const chip = await screen.findByRole("button", { name: "Chỉ hiện câu của Lan Phạm, 2 câu" });
    expect(chip).toHaveTextContent("Lan2");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByTestId("meeting-transcript");
    expect(within(list).queryByText("Hai")).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(within(list).getByText("Hai")).toBeInTheDocument();
  });

  it("plays the recording from a line's time (UNI-1995 #14)", async () => {
    respond({
      "/transcript": { segments: [seg("t1", "Một", 10, { speaker_name: "Lan" })] },
      "/recordings": {
        recordings: [{ id: "r1", meeting_id: "m1", status: "COMPLETE", started_at: "2026-09-22T02:00:00Z", ended_at: "2026-09-22T02:30:00Z" }],
      },
    });
    view();
    fireEvent.click(await screen.findByRole("button", { name: /^Phát bản ghi tại/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("lets a clerk correct a line and sends it to the server (UNI-1995 #5)", async () => {
    respond({
      "/transcript": { segments: [seg("t1", "anh Hung", 10, { speaker_name: "Lan", edited_at: "2026-09-22T05:00:00Z" })] },
      "/transcript/t1": { segment: seg("t1", "anh Hùng", 10) },
    });
    view(meeting, true);
    expect(await screen.findByText("đã sửa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Thao tác với câu của Lan/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sửa câu này" }));
    const dialog = await screen.findByRole("dialog", { name: "Sửa câu" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nội dung" }), { target: { value: "anh Hùng" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcript/t1", { method: "PATCH", body: { text: "anh Hùng" } }),
    );
  });

  it("opens on a cited line from ?segment= and marks it (UNI-1995 #14)", async () => {
    respond({ "/transcript": { segments: [seg("t5", "trước", 10), seg("t6", "câu được dẫn", 11)] } });
    view(meeting, false, fakeNav("/acme/team/meetings/m1?tab=transcript&segment=t6"));
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(list.querySelector('[data-segment-id="t6"]')).toHaveAttribute("aria-current", "true"));
    expect(list.querySelector('[data-segment-id="t6"]')).toHaveFocus();
  });

  it("loads a live meeting's earlier lines on demand", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [seg("t2", "câu t2", 20)], older_cursor: "o2", after_cursor: "x" });
      if (p.endsWith("/transcript?before=o2")) return Promise.resolve({ segments: [seg("t1", "câu t1", 10)] });
      return Promise.resolve({});
    });
    view({ ...meeting, status: "IN_PROGRESS" }, true);
    fireEvent.click(await screen.findByRole("button", { name: "Tải lời thoại trước đó" }));
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(within(list).getByText("câu t1")).toBeInTheDocument());
    expect(within(list).queryByRole("button", { name: "Tải lời thoại trước đó" })).not.toBeInTheDocument();
  });

  it("deletes a stretch ending on a sub-second line by naming both lines (UNI-1995 #5)", async () => {
    const lines = [
      { id: "t1", meeting_id: "m1", text: "Bắt đầu", spoken_at: "2026-09-22T02:10:00.250Z", speaker_name: "Lan" },
      { id: "t2", meeting_id: "m1", text: "Ngoài lề", spoken_at: "2026-09-22T02:10:00.900Z", speaker_name: "Lan" },
      { id: "t3", meeting_id: "m1", text: "Tiếp", spoken_at: "2026-09-22T02:11:00Z", speaker_name: "Lan" },
    ];
    respond({ "/transcript": { segments: lines, deleted: 2 } });
    view(meeting, true);
    await screen.findByText("Bắt đầu");
    fireEvent.click(screen.getAllByRole("button", { name: /^Thao tác với câu của Lan/ })[0]!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa từ câu này…" }));
    const dialog = await screen.findByRole("dialog", { name: "Xóa một đoạn lời thoại" });
    const end = within(dialog).getByRole("combobox", { name: "Đến hết câu" });
    fireEvent.click(end);
    const option = await screen.findByRole("option", { name: /Ngoài lề/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(end).toHaveTextContent("Ngoài lề"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcript?from_segment_id=t1&to_segment_id=t2", { method: "DELETE" }),
    );
  });

  it("draws no more-actions menu for a captions-only transcript with no recording or upload", async () => {
    respond({ "/transcript": { segments: [seg("t1", "Một", 10)] } });
    view(meeting, true);
    await screen.findByText("Một");
    expect(screen.queryByRole("button", { name: "Thao tác khác với lời thoại" })).not.toBeInTheDocument();
  });

  it("asks before deleting the whole transcript, then deletes it (UNI-1995 #5)", async () => {
    respond({
      "/transcript": { segments: [seg("t1", "Một", 10)], deleted: 1 },
      "/recordings": { recordings: [{ id: "r1", meeting_id: "m1", status: "COMPLETE", started_at: "2026-09-22T02:00:00Z" }] },
    });
    view(meeting, true);
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác khác với lời thoại" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa toàn bộ lời thoại" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Xóa toàn bộ lời thoại?" });
    expect(within(dialog).getByText(/Tóm tắt, biên bản và việc cần làm vẫn giữ nguyên/)).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/transcript", { method: "DELETE" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcript", { method: "DELETE" }));
  });

  it("lets a clerk delete an earlier upload with its recording, not only the latest (UNI-1995 #5)", async () => {
    respond({
      "/transcript": { segments: [] },
      "/transcriptions": {
        transcriptions: [
          { id: "t2", meeting_id: "m1", filename: "phan-2.m4a", status: "COMPLETE", created_at: "2026-09-22T04:00:00Z", completed_at: "2026-09-22T04:10:00Z" },
          { id: "t1", meeting_id: "m1", filename: "phan-1.m4a", status: "COMPLETE", created_at: "2026-09-22T03:00:00Z", completed_at: "2026-09-22T03:10:00Z" },
        ],
      },
    });
    view(meeting, true);
    const earlier = await screen.findByRole("list", { name: "Các tệp ghi âm tải lên trước" });
    fireEvent.click(within(earlier).getByRole("button", { name: 'Xóa tệp "phan-1.m4a" và lời thoại của nó' }));
    const dialog = await screen.findByRole("alertdialog", { name: "Xóa tệp ghi âm này?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcriptions/t1", { method: "DELETE" }));
  });

  it("says a cited line is gone when other lines remain (UNI-1995 #14)", async () => {
    respond({ "/transcript": { segments: [seg("t9", "Câu khác", 10)] } });
    view(meeting, false, fakeNav("/acme/team/meetings/m1?tab=transcript&segment=gone"));
    expect(await screen.findByText("Câu được dẫn không còn trong lời thoại.")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-transcript")).toHaveTextContent("Câu khác");
  });

  it("shows a region error line with a retry when the transcript does not load", async () => {
    let fail = true;
    requestMock.mockImplementation((path: unknown) =>
      String(path).includes("/transcript") && fail ? Promise.reject(new Error("boom")) : Promise.resolve({ segments: [seg("t1", "Đã tải", 10)] }),
    );
    view();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không tải được lời thoại.");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đã tải")).toBeInTheDocument();
  });
});

describe("TranscriptTab on M1 (AfterTranscript)", () => {
  function renderM1(set = (_: string) => {}) {
    routeMeeting("m1");
    setSessionUser(demoUser("lan"));
    const value = detailValue("m1", { tabs: { list: ["overview", "transcript", "minutes"], current: "transcript", set } });
    return render(
      wrapWithNav(
        <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
          <DetailContext.Provider value={value}>
            <TranscriptTab />
          </DetailContext.Provider>
        </WorkspaceProvider>,
      ),
    );
  }

  it("draws the chapter bar from the topics and a sticky divider per chapter", async () => {
    renderM1();
    const bar = await screen.findByRole("navigation", { name: "Chương" });
    await waitFor(() => expect(within(bar).getAllByRole("button")).toHaveLength(4));
    // Times are the viewer's clock (09:00 ICT): matched by shape so the suite runs in any zone.
    expect(within(bar).getByRole("button", { name: /^Mở đầu, \d\d:\d\d, 3 câu$/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /^Rà soát việc tồn tuần trước, \d\d:\d\d, 11 câu$/ })).toHaveStyle({ flexGrow: "3" });
    const list = screen.getByTestId("meeting-transcript");
    expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.replace(/^\d\d:\d\d/, ""))).toEqual([
      " · Mở đầu3 câu",
      " · Rà soát việc tồn tuần trước11 câu",
      " · Tiến độ kỹ thuật bản SaoMai POS 3.011 câu",
    ]);
  });

  it("marks the lines the overview cites, links back to them, and keeps only those on demand", async () => {
    const opened: string[] = [];
    renderM1((tab) => opened.push(tab));
    const list = await screen.findByTestId("meeting-transcript");
    const link = await within(list).findByRole("link", { name: "Được dẫn ở: Quyết định 1" });
    expect(link.closest("p")).toHaveTextContent("Được dẫn ở: Quyết định 1, Việc cần làm · Gửi báo giá gói doanh nghiệp cho chuỗi siêu thị Hòa Bình");
    fireEvent.click(link);
    expect(opened).toEqual(["overview"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Chỉ câu được trích" }));
    await waitFor(() => expect(list.querySelectorAll("li[data-segment-id]").length).toBeLessThan(25));
    expect([...list.querySelectorAll("li[data-segment-id]")].every((li) => li.textContent?.includes("Được dẫn ở:"))).toBe(true);
  });

  it("offers one chip per speaker with their line count", async () => {
    renderM1();
    const group = await screen.findByRole("group", { name: "Lọc theo người nói" });
    await waitFor(() => expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["LPLan10", "MTMinh9", "HVHà6"]));
  });
});
