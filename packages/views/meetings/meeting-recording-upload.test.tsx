import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MeetingRecordingUploadDialog, MeetingTranscriptionStatus } from "./meeting-recording-upload";

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
  // The resume record of one test must not resume the next one's upload.
  localStorage.clear();
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
    // In the tab order with the reason, never natively disabled.
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription("Chọn tệp ghi âm trước khi tải lên.");
    fireEvent.click(submit);
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(1000)] } });
    expect(screen.getByText("hop-chi-bo.mp3")).toBeInTheDocument();
    expect(submit).toHaveAccessibleDescription("Xác nhận đã thông báo cho người dự họp trước khi tải lên.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo cho người dự họp về việc ghi âm/ }));
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/transcriptions", {
        method: "POST",
        body: { upload_id: "up1", language: "vi", consent: true },
      }),
    );
    const open = requestMock.mock.calls.find((c) => c[0] === "/api/v1/meetings/m1/audio-upload-sessions");
    expect(open?.[1]).toMatchObject({ method: "POST", body: { filename: "hop-chi-bo.mp3", size_bytes: 1000 } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã nhận tệp. Ghi lời xong sẽ có thông báo."));
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
      fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(1000, "hop.mp4")] } });
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
      fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(1000, "hop.mp4")] } });
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

  it("keeps the file and offers a retry in the dialog when the upload is refused", async () => {
    const base = requestMock.getMockImplementation()!;
    let refuse = true;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (refuse && path === "/api/v1/meetings/m1/audio-upload-sessions") throw new Error("storage down");
      return base(path, init);
    });
    const onOpenChange = vi.fn();
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={onOpenChange} />));
    fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(1000)] } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tải lên và ghi lời" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải xong tệp.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("hop-chi-bo.mp3")).toBeInTheDocument();
    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("takes a file dropped on the picker", () => {
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
    const zone = screen.getByText("Chọn tệp").closest("label")!;
    fireEvent.drop(zone, { dataTransfer: { files: [mp3(1000)], types: ["Files"] } });
    expect(screen.getByText("hop-chi-bo.mp3")).toBeInTheDocument();
  });

  it("refuses a file over 2 GB before sending anything", () => {
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
    fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(3 * 1024 ** 3)] } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ }));
    expect(screen.getByText("Tệp lớn hơn 2 GB. Chia nhỏ rồi tải từng phần.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lên và ghi lời" })).toHaveAttribute("aria-disabled", "true");
    expect(requestMock).not.toHaveBeenCalled();
  });
});

function ready(onOpenChange = vi.fn()) {
  const view = render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={onOpenChange} />));
  fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(1000)] } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ }));
  return { ...view, onOpenChange, submit: () => fireEvent.click(screen.getByRole("button", { name: "Tải lên và ghi lời" })) };
}

/** A part PUT that hangs until the engine aborts it. */
function hangingPut() {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signals.push(signal);
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    ),
  );
  return signals;
}

const transcriptionPosts = () =>
  requestMock.mock.calls.filter((c) => c[0] === "/api/v1/meetings/m1/transcriptions" && c[1]?.method === "POST");

describe("MeetingRecordingUploadDialog — stop, resume, leave", () => {
  it("marks the consent required and says beside the footer why the upload is blocked", () => {
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
    expect(screen.getByRole("checkbox", { name: /Tôi đã thông báo/ })).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Chọn tệp ghi âm trước khi tải lên.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Tệp ghi âm"), { target: { files: [mp3(3 * 1024 ** 3)] } });
    expect(screen.getByRole("button", { name: "Tải lên và ghi lời" })).toHaveAccessibleDescription(
      "Chọn tệp nhỏ hơn 2 GB trước khi tải lên.",
    );
    // The dialog's own close button speaks the UI language.
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  });

  it("stops a running upload for real: the session is dropped and nothing is queued", async () => {
    const signals = hangingPut();
    const { onOpenChange, submit } = ready();
    submit();
    await waitFor(() => expect(signals).toHaveLength(1));
    // No close button mid-upload; the footer's Cancel becomes the stop.
    expect(screen.queryByRole("button", { name: "Đóng" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dừng tải lên" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(signals[0]!.aborted).toBe(true);
    expect(requestMock).toHaveBeenCalledWith("/api/v1/upload-sessions/s1", expect.objectContaining({ method: "DELETE" }));
    expect(transcriptionPosts()).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks before Escape abandons an upload, and keeps uploading on no", async () => {
    const signals = hangingPut();
    const { onOpenChange, submit } = ready();
    submit();
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(await screen.findByText("Dừng tải tệp lên?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục tải lên" }));
    await waitFor(() => expect(screen.queryByText("Dừng tải tệp lên?")).not.toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(signals[0]!.aborted).toBe(false);
  });

  it("warns before the tab closes mid-upload, and pauses the upload when the dialog unmounts", async () => {
    const signals = hangingPut();
    const { unmount, submit } = ready();
    submit();
    await waitFor(() => expect(signals).toHaveLength(1));
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    unmount();
    expect(signals[0]!.aborted).toBe(true);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    await act(async () => {});
    expect(transcriptionPosts()).toHaveLength(0);
  });

  it("resumes the same session on Retry instead of sending the file from byte 0", async () => {
    const base = requestMock.getMockImplementation()!;
    let completes = 0;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/upload-sessions/s1/complete" && completes++ === 0) {
        throw new ApiError("boom", "internal", 500);
      }
      if (path === "/api/v1/upload-sessions/s1" && (init?.method ?? "GET") === "GET") {
        return {
          session_id: "s1",
          status: "open",
          part_size: 8 << 20,
          total_parts: 1,
          completed_parts: [{ part_number: 1, etag: '"etag-1"' }],
          parts: [],
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      return base(path, init);
    });
    const { onOpenChange, submit } = ready();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải xong tệp.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const opens = requestMock.mock.calls.filter((c) => c[0] === "/api/v1/meetings/m1/audio-upload-sessions");
    expect(opens).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("words a refusal of the file itself and offers no Retry that cannot help", async () => {
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/upload-sessions/s1/complete") {
        throw new ApiError("định dạng tệp không được hỗ trợ", "unsupported_media_type", 415);
      }
      return base(path, init);
    });
    ready().submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("UNI không đọc được định dạng của tệp này.");
    expect(screen.queryByText("định dạng tệp không được hỗ trợ")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("says a lost connection in words, with a Retry that resumes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/meetings/m1/audio-upload-sessions") throw new TypeError("Failed to fetch");
      return base(path, init);
    });
    ready().submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Mất kết nối khi đang tải lên.");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("queues nothing when the dialog unmounts while the server still verifies the file", async () => {
    let verified: (value: unknown) => void = () => {};
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/upload-sessions/s1/complete") {
        return new Promise((resolve) => (verified = resolve));
      }
      return base(path, init);
    });
    const { unmount, submit } = ready();
    submit();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/upload-sessions/s1/complete", expect.anything()));
    unmount();
    await act(async () => {
      verified({ upload_id: "up1", checksum_sha256: "a".repeat(64), size_bytes: 1000, claim_expires_at: "2099-01-01T00:00:00Z" });
    });
    expect(transcriptionPosts()).toHaveLength(0);
  });

  it.each([
    ["an expired session, sent again from the start", new ApiError("x", "upload_session_expired", 410), "Lượt tải lên đã hết hạn.", true],
    ["too many unfinished uploads, with no Retry", new ApiError("x", "upload_sessions_exhausted", 429), "quá nhiều lượt tải lên chưa xong", false],
    ["a plan without transcription, not the file", new ApiError("x", "entitlement_required", 403), "Gói hiện tại của tổ chức", false],
  ])("words %s", async (_name, err, copy, retry) => {
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/meetings/m1/audio-upload-sessions") throw err;
      return base(path, init);
    });
    ready().submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.queryByText(/Chọn tệp khác/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" }) !== null).toBe(retry);
  });

  it("says the file is being processed once every byte is sent, instead of sitting at 100%", async () => {
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/v1/upload-sessions/s1/complete") return new Promise(() => {});
      return base(path, init);
    });
    ready().submit();
    expect(await screen.findAllByText("Đang xử lý tệp…")).not.toHaveLength(0);
    expect(screen.queryByText(/Đang tải lên… 100%/)).not.toBeInTheDocument();
  });

  it("refuses a dropped file the picker would not offer", () => {
    render(wrap(<MeetingRecordingUploadDialog meetingId="m1" onOpenChange={() => {}} />));
    const zone = screen.getByText("Chọn tệp").closest("label")!;
    const pdf = new File(["%PDF"], "bien-ban.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [pdf], types: ["Files"] } });
    expect(screen.getByText('"bien-ban.pdf" không phải tệp ghi âm. Chọn tệp MP3, M4A, WAV, OGG, WebM hoặc video MP4.')).toBeInTheDocument();
    expect(screen.getByText("Chọn tệp")).toBeInTheDocument();
  });
});

describe("MeetingTranscriptionStatus", () => {
  it("says since when it waits and at what time it finished, in the viewer's clock", async () => {
    const at = new Date();
    at.setHours(14, 5, 0, 0);
    requestMock.mockImplementation(async () => ({
      transcriptions: [{ ...transcription, status: "QUEUED", created_at: at.toISOString() }],
    }));
    render(wrap(<MeetingTranscriptionStatus meetingId="m1" />));
    expect(await screen.findByText('Đang chờ ghi lời "hop-chi-bo.mp3" · từ 14:05')).toBeInTheDocument();
  });

  it("says why the latest recording failed", async () => {
    requestMock.mockImplementation(async () => ({
      transcriptions: [{ ...transcription, status: "FAILED", error_code: "timeout" }, { ...transcription, id: "t0", status: "COMPLETE" }],
    }));
    const onRetry = vi.fn();
    render(wrap(<MeetingTranscriptionStatus meetingId="m1" onRetry={onRetry} />));
    // An error with the way forward, inside one region that announces the change.
    const region = screen.getByTestId("meeting-transcription-status");
    expect(region).toHaveAttribute("role", "status");
    expect(await screen.findByText('Không ghi lời được "hop-chi-bo.mp3". Quá thời gian chờ.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại tệp" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
