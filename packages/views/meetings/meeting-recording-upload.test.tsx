import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import {
  MeetingRecordingUploadButton,
  MeetingRecordingUploadDialog,
  MeetingTranscriptionStatus,
} from "./meeting-recording-upload";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mp3(size: number, name = "hop-chi-bo.mp3"): File {
  const file = new File([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])], name, { type: "audio/mpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const transcription = {
  id: "t1",
  meeting_id: "m1",
  filename: "hop-chi-bo.mp3",
  status: "QUEUED",
};

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  requestMock.mockReset();
  // No XHR in jsdom: the part PUT goes through fetch.
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })),
  );
  requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (path === "/api/v1/meetings/m1/audio-upload-sessions" && method === "POST") {
      return {
        session_id: "s1",
        part_size: 8 << 20,
        total_parts: 1,
        completed_parts: [],
        parts: [{ part_number: 1, method: "PUT", url: "https://s3.test/part-1", headers: {}, expires_at: "2099-01-01T00:00:00Z" }],
        expires_at: "2099-01-02T00:00:00Z",
      };
    }
    if (path === "/api/v1/upload-sessions/s1/complete") {
      return { upload_id: "up1", checksum_sha256: "a".repeat(64), size_bytes: 1000, claim_expires_at: "2099-01-01T00:00:00Z" };
    }
    if (path === "/api/v1/meetings/m1/transcriptions" && method === "POST") return { transcription };
    if (path === "/api/v1/workspaces/w1/meeting-capabilities") return { transcription: true };
    if (path === "/api/v1/meetings/m1/transcriptions") return { transcriptions: [] };
    return {};
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MeetingRecordingUploadDialog", () => {
  it("waits for a file and the recording consent, then uploads and queues the transcription", async () => {
    const onOpenChange = vi.fn();
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={onOpenChange} />));
    const submit = screen.getByRole("button", { name: "Tải lên và ghi lời" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("File ghi âm"), { target: { files: [mp3(1000)] } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo cho người dự họp về việc ghi âm/ }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcriptions", {
        method: "POST",
        body: { upload_id: "up1", language: "vi", consent: true },
      }),
    );
    const open = requestMock.mock.calls.find((c) => c[0] === "/api/v1/meetings/m1/audio-upload-sessions");
    expect(open?.[1]).toMatchObject({ method: "POST", body: { filename: "hop-chi-bo.mp3", size_bytes: 1000 } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã nhận file. Ghi lời xong sẽ có thông báo."));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reads the recording's length from its metadata and sends it for the quota estimate", async () => {
    // jsdom loads no media: the element answers its metadata as a browser would.
    const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:rec"), revokeObjectURL: vi.fn() });
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    const duration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "duration");
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 1080.5 });
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      set(this: HTMLMediaElement) {
        this.dispatchEvent(new Event("loadedmetadata"));
      },
    });
    try {
      render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
      fireEvent.change(screen.getByLabelText("File ghi âm"), { target: { files: [mp3(1000, "hop.mp4")] } });
      await act(async () => {});
      fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ }));
      fireEvent.click(screen.getByRole("button", { name: "Tải lên và ghi lời" }));
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcriptions", {
          method: "POST",
          body: { upload_id: "up1", language: "vi", consent: true, duration_seconds: 1080.5 },
        }),
      );
      const open = requestMock.mock.calls.find((c) => c[0] === "/api/v1/meetings/m1/audio-upload-sessions");
      expect(open?.[1]).toMatchObject({ body: { size_bytes: 1000, duration_seconds: 1080.5 } });
    } finally {
      Object.assign(URL, urls);
      if (src) Object.defineProperty(HTMLMediaElement.prototype, "src", src);
      if (duration) Object.defineProperty(HTMLMediaElement.prototype, "duration", duration);
    }
  });

  it("gives up on the length after 5 s and lets go of the file", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:stuck"), revokeObjectURL: revoke });
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    const removeAttribute = vi.spyOn(HTMLMediaElement.prototype, "removeAttribute");
    // A browser that never answers the metadata.
    Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true, set() {} });
    try {
      render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
      fireEvent.change(screen.getByLabelText("File ghi âm"), { target: { files: [mp3(1000, "hop.mp4")] } });
      await act(async () => {
        vi.advanceTimersByTime(4999);
      });
      expect(revoke).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(revoke).toHaveBeenCalledWith("blob:stuck");
      expect(removeAttribute).toHaveBeenCalledWith("src");
    } finally {
      vi.useRealTimers();
      removeAttribute.mockRestore();
      Object.assign(URL, urls);
      if (src) Object.defineProperty(HTMLMediaElement.prototype, "src", src);
    }
  });

  it("refuses a file over 2 GiB before sending anything", () => {
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
    fireEvent.change(screen.getByLabelText("File ghi âm"), { target: { files: [mp3(3 * 1024 ** 3)] } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ }));
    expect(screen.getByText("File lớn hơn 2 GiB. Chia nhỏ rồi tải từng phần.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lên và ghi lời" })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("MeetingRecordingUploadButton", () => {
  it("shows only where batch transcription is available", async () => {
    const { unmount } = render(wrap(<MeetingRecordingUploadButton workspaceId="w1" meetingId="m1" />));
    expect(await screen.findByRole("button", { name: "Tải file ghi âm" })).toBeInTheDocument();
    unmount();
    requestMock.mockImplementation(async () => ({ transcription: false }));
    render(wrap(<MeetingRecordingUploadButton workspaceId="w1" meetingId="m1" />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Tải file ghi âm" })).toBeNull();
  });
});

describe("MeetingTranscriptionStatus", () => {
  it("says why the latest recording failed", async () => {
    requestMock.mockImplementation(async () => ({
      transcriptions: [{ ...transcription, status: "FAILED", error_code: "timeout" }, { ...transcription, id: "t0", status: "COMPLETE" }],
    }));
    render(wrap(<MeetingTranscriptionStatus meetingId="m1" />));
    expect(await screen.findByText('Không ghi lời được "hop-chi-bo.mp3" · Quá thời gian chờ.')).toBeInTheDocument();
  });
});
