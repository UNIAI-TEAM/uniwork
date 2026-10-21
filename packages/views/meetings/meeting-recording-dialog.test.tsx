import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getI18n } from "react-i18next";
import { requestMock, wrap } from "../test/api-mock";
import { MeetingRecordingDialog, recordingCaptionsVtt } from "./meeting-recording-dialog";

const resolvePlayback = vi.fn();
const loadBlob = vi.fn();
vi.mock("@uniwork/core/api/endpoints/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/api/endpoints/meetings")>()),
  resolveMeetingRecordingPlayback: (...args: unknown[]) => resolvePlayback(...args),
  loadMeetingRecordingBlob: (...args: unknown[]) => loadBlob(...args),
}));

const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
let made = 0;
beforeEach(() => {
  made = 0;
  resolvePlayback.mockReset();
  loadBlob.mockReset();
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++made}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  Object.assign(URL, urls);
});

beforeAll(() => {
  initI18n();
});

describe("MeetingRecordingDialog", () => {
  it("holds the player's shape with an announced skeleton while loading", () => {
    resolvePlayback.mockReturnValue(new Promise(() => {}));
    render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-loading" />));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Đang tải bản ghi…");
    expect(status.querySelector(".aspect-video")).not.toBeNull();
  });

  it("reports a failed load as an alert with a retry that loads again", async () => {
    resolvePlayback.mockReset();
    resolvePlayback.mockRejectedValue(new Error("boom"));
    render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-error" />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không phát được bản ghi.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(resolvePlayback).toHaveBeenCalledTimes(2));
  });

  it("revokes the whole-file blob when it closes and aborts a load still running", async () => {
    resolvePlayback.mockResolvedValue({ kind: "blob", url: "blob:file" });
    const { rerender } = render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-blob" />));
    await waitFor(() => expect(document.querySelector("video")).toHaveAttribute("src", "blob:file"));
    rerender(wrap(<MeetingRecordingDialog open={false} onOpenChange={() => {}} meetingId="m1" recordingId="r-blob" />));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");

    let signal: AbortSignal | undefined;
    resolvePlayback.mockImplementation((_m: string, _r: string, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise(() => {});
    });
    rerender(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-slow" />));
    await waitFor(() => expect(signal).toBeDefined());
    rerender(wrap(<MeetingRecordingDialog open={false} onOpenChange={() => {}} meetingId="m1" recordingId="r-slow" />));
    expect(signal!.aborted).toBe(true);
  });

  it("falls back to the file with a signal when the presigned URL fails in the player", async () => {
    resolvePlayback.mockResolvedValue({ kind: "remote", url: "https://s3.test/rec", expiresAt: "2099-01-01T00:00:00Z" });
    loadBlob.mockResolvedValue(new Blob(["x"]));
    const { rerender } = render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-remote" />));
    await waitFor(() => expect(document.querySelector("video")).toHaveAttribute("src", "https://s3.test/rec"));
    fireEvent.error(document.querySelector("video")!);
    await waitFor(() => expect(loadBlob).toHaveBeenCalledWith("m1", "r-remote", { signal: expect.any(AbortSignal) }));
    const blob = await waitFor(() => {
      const src = document.querySelector("video")?.getAttribute("src");
      expect(src).toMatch(/^blob:/);
      return src!;
    });
    rerender(wrap(<MeetingRecordingDialog open={false} onOpenChange={() => {}} meetingId="m1" recordingId="r-remote" />));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(blob);

    // Opened again (the list keeps the dialog mounted): the presigned URL first, not the whole file.
    rerender(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-remote" />));
    await waitFor(() => expect(document.querySelector("video")).toHaveAttribute("src", "https://s3.test/rec"));
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it("captions the recording from the transcript lines spoken while it ran", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path.includes("/recordings")) {
        return { recordings: [{ id: "r-cap", meeting_id: "m1", status: "COMPLETE", started_at: "2026-10-20T02:00:00Z", ended_at: "2026-10-20T02:10:00Z" }] };
      }
      if (path.includes("/transcript")) {
        return { segments: [{ id: "s1", meeting_id: "m1", speaker_name: "An", text: "Chốt ngày giao", spoken_at: "2026-10-20T02:00:05Z" }] };
      }
      return {};
    });
    resolvePlayback.mockResolvedValue({ kind: "remote", url: "https://s3.test/cap", expiresAt: "2099-01-01T00:00:00Z" });
    render(wrap(<MeetingRecordingDialog open onOpenChange={() => {}} meetingId="m1" recordingId="r-cap" />));
    const track = await waitFor(() => {
      const el = document.querySelector("track");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(track).toHaveAttribute("kind", "captions");
    expect(track.getAttribute("src")).toMatch(/^blob:/);
  });
});

describe("recordingCaptionsVtt", () => {
  const t = getI18n().t;
  const line = (id: string, at: string, text: string) => ({ id, meeting_id: "m1", speaker_name: "An", text, spoken_at: at });

  it("times each line from the recording's start until the next one, and leaves out lines outside it", () => {
    const vtt = recordingCaptionsVtt(
      [
        line("s0", "2026-10-20T01:59:00Z", "trước khi ghi"),
        line("s2", "2026-10-20T02:00:07Z", "Đồng ý <ngay>"),
        line("s1", "2026-10-20T02:00:05Z", "Chốt ngày giao"),
        line("s3", "2026-10-20T02:20:00Z", "sau khi dừng"),
      ],
      "2026-10-20T02:00:00Z",
      "2026-10-20T02:10:00Z",
      t,
    );
    expect(vtt).toBe(
      "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nAn: Chốt ngày giao\n\n00:00:07.000 --> 00:00:13.000\nAn: Đồng ý &lt;ngay&gt;\n",
    );
  });

  it("is null when nothing was said while the recording ran", () => {
    expect(recordingCaptionsVtt([line("s0", "2026-10-20T01:59:00Z", "x")], "2026-10-20T02:00:00Z", undefined, t)).toBeNull();
    expect(recordingCaptionsVtt([], undefined, undefined, t)).toBeNull();
  });
});
