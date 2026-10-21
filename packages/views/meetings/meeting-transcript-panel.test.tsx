import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
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
    for (const [suffix, body] of Object.entries(routes)) if (p.endsWith(suffix)) return Promise.resolve(body);
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
    render(wrapWithNav(<MeetingTranscriptPanel workspaceId="w1" meeting={meeting} canClerk />));

    fireEvent.click(await screen.findByRole("button", { name: /Xem lời thoại \(1\+ câu\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tải lời thoại trước đó" }));
    const list = await screen.findByTestId("meeting-transcript");
    await waitFor(() => expect(within(list).getByText("câu t1")).toBeInTheDocument());
    expect(within(list).queryByRole("button", { name: "Tải lời thoại trước đó" })).not.toBeInTheDocument();
  });
});
