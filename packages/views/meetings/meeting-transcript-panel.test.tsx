import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingTranscriptPanel } from "./meeting-transcript-panel";

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
    // Matched without the query: an ended meeting reads forward (?order=asc&limit=…).
    const bare = p.split("?")[0] ?? p;
    for (const [suffix, body] of Object.entries(routes)) if (bare.endsWith(suffix)) return Promise.resolve(body);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("MeetingTranscriptPanel", () => {
  it("says an ended meeting has no transcript, without suggesting captions", async () => {
    respond({ "/transcript": { segments: [] } });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    expect(await screen.findByText("Cuộc họp này không có bản ghi lời thoại.")).toBeInTheDocument();
    expect(screen.queryByText(/Bật phụ đề/)).not.toBeInTheDocument();
    // Nothing to read: no "Show transcript (0 lines)".
    expect(screen.queryByRole("button", { name: /Xem lời thoại/ })).not.toBeInTheDocument();
  });

  it("says the recordings did not load instead of hiding them, and why a recording failed", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/recordings")) return Promise.reject(new Error("Failed to fetch"));
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [] });
      return Promise.resolve({});
    });
    const { unmount } = render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    expect(await screen.findByText("Không tải được bản ghi của cuộc họp.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    unmount();

    respond({
      "/transcript": { segments: [] },
      "/recordings": { recordings: [{ id: "r1", meeting_id: "m1", status: "FAILED", started_at: "2026-09-22T02:00:00Z" }] },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    expect(await screen.findByText("Không lưu được bản ghi này.")).toHaveClass("text-destructive");
  });

  it("points a live meeting with no transcript at the captions", async () => {
    respond({ "/transcript": { segments: [] } });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={{ ...meeting, status: "IN_PROGRESS" }} canClerk />));
    expect(await screen.findByText(/Bật phụ đề trong phòng họp/)).toBeInTheDocument();
  });

  it("puts the upload in view for a clerk where transcription is available", async () => {
    respond({ "/transcript": { segments: [] }, "/meeting-capabilities": { transcription: true } });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
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
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    expect(await screen.findByRole("button", { name: "Tải lại tệp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải tệp ghi âm" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tải tệp ghi âm lên để UNI ghi lời/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại tệp" }));
    expect(await screen.findByRole("dialog", { name: "Tải tệp ghi âm lên" })).toBeInTheDocument();
  });

  it("says an upload replaces the room's transcript (UNI-1995 #11)", async () => {
    respond({
      "/transcript": { segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z", source: "AGENT" }] },
      "/meeting-capabilities": { transcription: true },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    fireEvent.click(await screen.findByRole("button", { name: "Tải tệp ghi âm" }));
    const dialog = await screen.findByRole("dialog", { name: "Tải tệp ghi âm lên" });
    expect(within(dialog).getByText(/thay cho lời thoại đó/)).toBeInTheDocument();
  });

  it("offers no upload where the workspace cannot transcribe", async () => {
    respond({ "/transcript": { segments: [] }, "/meeting-capabilities": { transcription: false } });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    await screen.findByText("Cuộc họp này không có bản ghi lời thoại.");
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meeting-capabilities"))).toBe(true));
    expect(screen.queryByRole("button", { name: "Tải tệp ghi âm" })).not.toBeInTheDocument();
  });

  it("names speakers in the reader's language: the room mic's and an uploaded file's", async () => {
    respond({
      "/transcript": {
        segments: [
          { id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z", speaker_name: "x", speaker_label: "k:1:A", room_speaker: 2 },
          { id: "t2", meeting_id: "m1", text: "Hai", spoken_at: "2026-09-22T02:11:00Z", speaker_name: "x", speaker_label: "k:1:?" },
          { id: "t3", meeting_id: "m1", text: "Ba", spoken_at: "2026-09-22T02:12:00Z", speaker_name: "Chị Lan" },
          { id: "t4", meeting_id: "m1", text: "Bốn", spoken_at: "2026-09-22T02:13:00Z", speaker_name: "x", speaker_label: "upload:T1:A", room_speaker: 1 },
        ],
      },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem lời thoại (4 câu)" }));
    const list = await screen.findByTestId("meeting-transcript");
    expect(within(list).getByText("Hội trường · Người nói 2")).toBeInTheDocument();
    expect(within(list).getByText("Hội trường · Không rõ")).toBeInTheDocument();
    expect(within(list).getByText("Chị Lan")).toBeInTheDocument();
    expect(within(list).getByText("Người nói 1")).toBeInTheDocument();
    // Each line says when it was said, and the list scrolls from the keyboard.
    expect(within(list).getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(4);
    expect(list).toHaveAttribute("tabindex", "0");
  });

  it("reads an ended meeting from its start and loads more at the bottom (UNI-1995 #9)", async () => {
    const seg = (id: string, min: number) => ({
      id,
      meeting_id: "m1",
      text: `câu ${id}`,
      spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`,
    });
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript?order=asc&limit=200")) return Promise.resolve({ segments: [seg("t1", 10)], newer_cursor: "n1" });
      if (p.endsWith("/transcript?from=n1&limit=200")) return Promise.resolve({ segments: [seg("t2", 20)] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    fireEvent.click(await screen.findByRole("button", { name: /Xem lời thoại \(1\+ câu\)/ }));
    const list = await screen.findByTestId("meeting-transcript");
    expect(within(list).getByText("câu t1")).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Tải lời thoại trước đó" })).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Tải thêm lời thoại" }));
    await waitFor(() => expect(within(list).getByText("câu t2")).toBeInTheDocument());
    const texts = within(list).getAllByText(/^câu t/).map((n) => n.textContent);
    expect(texts).toEqual(["câu t1", "câu t2"]);
  });

  it("searches what is loaded, marks the matches and offers a speaker filter (UNI-1995 #14)", async () => {
    respond({
      "/transcript": {
        segments: [
          { id: "t1", meeting_id: "m1", text: "Chốt ngân sách quý", spoken_at: "2026-09-22T02:10:00Z", speaker_name: "Lan" },
          { id: "t2", meeting_id: "m1", text: "Lịch demo thứ Sáu", spoken_at: "2026-09-22T02:11:00Z", speaker_name: "Hùng" },
          { id: "t3", meeting_id: "m1", text: "Ngan sach tang", spoken_at: "2026-09-22T02:12:00Z", speaker_name: "Hùng" },
        ],
      },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem lời thoại (3 câu)" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm trong lời thoại" }), { target: { value: "ngan sach" } });
    const list = screen.getByTestId("meeting-transcript");
    expect(within(list).queryByText("Lịch demo thứ Sáu")).not.toBeInTheDocument();
    expect([...list.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["ngân sách", "Ngan sach"]);
    expect(screen.getByText("2 câu khớp")).toBeInTheDocument();
    // Two people spoke: the speaker filter is offered.
    expect(screen.getByRole("combobox", { name: "Người nói" })).toBeInTheDocument();
  });

  it("plays the recording from a line's time (UNI-1995 #14)", async () => {
    respond({
      "/transcript": { segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z", speaker_name: "Lan" }] },
      "/recordings": {
        recordings: [
          { id: "r1", meeting_id: "m1", status: "COMPLETE", started_at: "2026-09-22T02:00:00Z", ended_at: "2026-09-22T02:30:00Z" },
        ],
      },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem lời thoại (1 câu)" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Phát bản ghi tại/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("lets a clerk correct a line and sends it to the server (UNI-1995 #5)", async () => {
    respond({
      "/transcript": {
        segments: [{ id: "t1", meeting_id: "m1", text: "anh Hung", spoken_at: "2026-09-22T02:10:00Z", speaker_name: "Lan", edited_at: "2026-09-22T05:00:00Z" }],
      },
      "/transcript/t1": { segment: { id: "t1", meeting_id: "m1", text: "anh Hùng", spoken_at: "2026-09-22T02:10:00Z" } },
    });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem lời thoại (1 câu)" }));
    expect(screen.getByText("đã sửa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Thao tác với câu của Lan/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sửa câu" }));
    const dialog = await screen.findByRole("dialog", { name: "Sửa câu" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nội dung" }), { target: { value: "anh Hùng" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcript/t1", { method: "PATCH", body: { text: "anh Hùng" } }),
    );
  });

  it("opens on a cited line from ?segment= and marks it (UNI-1995 #14)", async () => {
    respond({
      "/transcript": {
        segments: [
          { id: "t5", meeting_id: "m1", text: "trước", spoken_at: "2026-09-22T02:10:00Z" },
          { id: "t6", meeting_id: "m1", text: "câu được dẫn", spoken_at: "2026-09-22T02:11:00Z" },
        ],
        older_cursor: "o5",
      },
    });
    render(
      wrapWithNav(
        <MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />,
        fakeNav("/acme/team/meetings/m1?section=transcript&segment=t6"),
      ),
    );
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(list.querySelector('[data-segment-id="t6"]')).toHaveClass("bg-accent"));
    expect(requestMock.mock.calls.some(([p]) => String(p).includes("/transcript?around=t6"))).toBe(true);
    expect(within(list).getByRole("button", { name: "Tải lời thoại trước đó" })).toBeInTheDocument();
  });

  it("says more lines exist and loads the earlier transcript on demand", async () => {
    const seg = (id: string, min: number) => ({
      id,
      meeting_id: "m1",
      text: `câu ${id}`,
      spoken_at: `2026-09-22T02:${String(min).padStart(2, "0")}:00Z`,
    });
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/transcript")) return Promise.resolve({ segments: [seg("t2", 20)], older_cursor: "o2", after_cursor: "x" });
      if (p.endsWith("/transcript?before=o2")) return Promise.resolve({ segments: [seg("t1", 10)] });
      return Promise.resolve({});
    });
    // A live meeting keeps its newest page first.
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={{ ...meeting, status: "IN_PROGRESS" }} canClerk />));

    fireEvent.click(await screen.findByRole("button", { name: /Xem lời thoại \(1\+ câu\)/ }));
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
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem lời thoại (3 câu)" }));
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
    // No times leave the client: the server reads both lines' own.
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcript?from_segment_id=t1&to_segment_id=t2", { method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Xóa một đoạn lời thoại" })).not.toBeInTheDocument());
  });

  it("asks before deleting the whole transcript, then deletes it (UNI-1995 #5)", async () => {
    respond({ "/transcript": { segments: [{ id: "t1", meeting_id: "m1", text: "Một", spoken_at: "2026-09-22T02:10:00Z" }], deleted: 1 } });
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
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
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));
    const earlier = await screen.findByRole("list", { name: "Các tệp ghi âm tải lên trước" });
    expect(screen.getByRole("button", { name: "Xóa tệp ghi âm và lời thoại" })).toBeInTheDocument();
    fireEvent.click(within(earlier).getByRole("button", { name: 'Xóa tệp "phan-1.m4a" và lời thoại của nó' }));
    const dialog = await screen.findByRole("alertdialog", { name: "Xóa tệp ghi âm này?" });
    expect(within(dialog).getByText(/phan-1\.m4a/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcriptions/t1", { method: "DELETE" }));
  });

  it("says a cited line is gone when other lines remain (UNI-1995 #14)", async () => {
    respond({ "/transcript": { segments: [{ id: "t9", meeting_id: "m1", text: "Câu khác", spoken_at: "2026-09-22T02:10:00Z" }] } });
    render(
      wrapWithNav(
        <MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk={false} />,
        fakeNav("/acme/team/meetings/m1?section=transcript&segment=gone"),
      ),
    );
    expect(await screen.findByText("Câu được dẫn không còn trong lời thoại.")).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([p]) => String(p).includes("/transcript?around=gone"))).toBe(true);
    expect(screen.getByTestId("meeting-transcript")).toHaveTextContent("Câu khác");
  });
});
