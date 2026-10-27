import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { meetingKeys } from "@uniwork/core/meetings";
import { memoryRecordingStore, type RecordingStore } from "@uniwork/core/meetings/recorder";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingRecordView } from "./record-view";

const USER: User = {
  id: "u-lan",
  email: "lan@saomai.test",
  display_name: "Lan Phạm",
  onboarded_at: "2026-10-01T00:00:00Z",
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
};

const meeting: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Giao ban kinh doanh",
  description: "",
  starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  ends_at: new Date(Date.now() + 55 * 60_000).toISOString(),
  room_name: "uw_mtg_m1",
  created_by: USER.id,
  status: "SCHEDULED",
  host_user_id: USER.id,
  venue: "in_person",
};

/** A microphone track the test can end, as a locked phone or an unplugged mic would. */
class FakeTrack extends EventTarget {
  kind = "audio";
  enabled = true;
  stop = vi.fn();
}
let tracks: FakeTrack[] = [];

class FakeRecorder {
  static isTypeSupported = () => true;
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // The last slice of audio, as a real recorder hands it over on stop.
    this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
    this.onstop?.();
  }
}

function route({
  transcription = true,
  over = {},
  capsFail = false,
  rosterFail = () => false,
}: { transcription?: boolean; over?: Partial<Meeting>; capsFail?: boolean; rosterFail?: () => boolean } = {}) {
  requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (path === "/api/v1/meetings/m1/held" && method === "POST") return { meeting: { ...meeting, ...over, status: "ENDED" } };
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
      return { upload_id: "up1", checksum_sha256: "a".repeat(64), size_bytes: 5, claim_expires_at: "2099-01-01T00:00:00Z" };
    }
    if (path === "/api/v1/meetings/m1/transcriptions" && method === "POST") {
      return { transcription: { id: "t1", meeting_id: "m1", filename: "ghi-am.webm", status: "QUEUED" } };
    }
    if (path === "/api/v1/meetings/m1") return { meeting: { ...meeting, ...over } };
    if (path === "/api/v1/meetings/m1/participants") {
      if (rosterFail()) throw new TypeError("Failed to fetch");
      return {
        participants: [
          { id: "p1", meeting_id: "m1", principal_type: "USER", user_id: USER.id, status: "ACTIVE", role: "HOST" },
          { id: "p2", meeting_id: "m1", principal_type: "USER", user_id: "u-ha", status: "ACTIVE", role: "ATTENDEE" },
        ],
      };
    }
    if (path === "/api/v1/workspaces/w1/meeting-capabilities") {
      if (capsFail) throw new ApiError("lỗi máy chủ", "internal", 500);
      return { transcription };
    }
    if (path === "/api/v1/workspaces/w1/me") return { membership: { user_id: USER.id, role: "member", source: "membership" } };
    if (path === "/api/v1/workspaces/w1/members") return { members: [{ user_id: USER.id, role: "member" }] };
    return {};
  });
}

function renderView(store: RecordingStore, onBack = vi.fn(), client?: QueryClient, { send = false, onSent = vi.fn() } = {}) {
  render(
    wrapWithNav(
      <StrictMode>
        <MeetingRecordView
          workspaceId="w1"
          meetingId="m1"
          store={store}
          onBack={onBack}
          onSent={onSent}
          send={send}
          meetingsHref="/o/w/meetings"
        />
      </StrictMode>,
      undefined,
      client,
    ),
  );
  return onBack;
}

/** One closed part of 5 minutes already on this device, as a closed tab leaves it. */
async function storedPart(store: RecordingStore) {
  const startedAt = Date.now() - 600_000;
  await store.createPart({
    id: "earlier", userId: USER.id, meetingId: "m1", startedAt, lastChunkAt: startedAt,
    endedAt: null, mimeType: "audio/webm", bytes: 0, language: "vi", offsetSeconds: 0,
  });
  await store.appendChunk("earlier", 0, new Blob(["audio"]), startedAt + 300_000);
  await store.finishPart("earlier", startedAt + 300_000);
}

const transcriptionPosts = () =>
  requestMock.mock.calls.filter(([path, init]) => path === "/api/v1/meetings/m1/transcriptions" && (init as { method?: string } | undefined)?.method === "POST");

async function startRecording() {
  fireEvent.click(await screen.findByRole("checkbox", { name: /Tôi đã thông báo cho người dự họp về việc ghi âm/ }));
  fireEvent.click(screen.getByRole("button", { name: "Bắt đầu ghi âm" }));
  expect(await screen.findByText("Đang ghi âm")).toBeInTheDocument();
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  route();
  setSessionUser(USER);
  tracks = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  // The part PUT goes through fetch (no XHR in jsdom); its resume record must not leak between tests.
  localStorage.clear();
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([{ deviceId: "mic1", kind: "audioinput", label: "Built-in Mic" }]),
      getUserMedia: vi.fn(async () => {
        const track = new FakeTrack();
        tracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthStoreForTests();
});

describe("MeetingRecordView", () => {
  it("starts only after the consent", async () => {
    const store = memoryRecordingStore();
    renderView(store);
    const start = await screen.findByRole("button", { name: "Bắt đầu ghi âm" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    expect(start).toHaveAccessibleDescription("Tích ô xác nhận ở trên để bắt đầu");
    fireEvent.click(start);
    // Give a start that slipped through every chance to open a part.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText("Đang ghi âm")).not.toBeInTheDocument();
    expect(await store.listParts(USER.id, "m1")).toEqual([]);

    await startRecording();
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
    expect(screen.getByTestId("meeting-record")).toBeInTheDocument();
  });

  it("pauses and resumes", async () => {
    renderView(memoryRecordingStore());
    await startRecording();
    fireEvent.click(screen.getByRole("button", { name: "Tạm dừng" }));
    expect(await screen.findByText("Đã tạm dừng")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ghi tiếp" }));
    expect(await screen.findByText("Đang ghi âm")).toBeInTheDocument();
  });

  it("an interrupted recording offers to continue or send", async () => {
    renderView(memoryRecordingStore());
    await startRecording();
    act(() => void tracks.at(-1)!.dispatchEvent(new Event("ended")));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ghi âm bị ngắt");
    expect(alert).toHaveTextContent("0:00 đã lưu an toàn");
    expect(screen.getByRole("button", { name: "Ghi tiếp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kết thúc và gửi" })).toBeInTheDocument();

    // Back on the microphone the person chose, not the browser's default.
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia);
    getUserMedia.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Ghi tiếp" }));
    expect(await screen.findByText("Đang ghi âm")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "mic1" } } });
  });

  it("picks the recording language", async () => {
    const store = memoryRecordingStore();
    renderView(store);
    fireEvent.click(await screen.findByRole("radio", { name: "Tiếng Anh" }));
    await startRecording();
    const parts = await store.listParts(USER.id, "m1");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ language: "en" });
  });

  it("continues a recording already on this device", async () => {
    const store = memoryRecordingStore();
    const startedAt = Date.now() - 600_000;
    await store.createPart({
      id: "earlier", userId: USER.id, meetingId: "m1", startedAt, lastChunkAt: startedAt + 300_000,
      endedAt: startedAt + 300_000, mimeType: "audio/webm", bytes: 10, language: "vi", offsetSeconds: 0,
    });
    renderView(store);
    // The prep screen offers no choice yet the stored part already made: its language carries on.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Tiếng Việt" })).toBeChecked());
    await startRecording();
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
    const parts = await store.listParts(USER.id, "m1");
    expect(parts).toHaveLength(2);
    expect(parts[1]!.offsetSeconds).toBeGreaterThanOrEqual(600);
  });

  it.each([
    ["the organization cannot transcribe", { transcription: false }],
    ["the viewer is not a clerk", { over: { host_user_id: "u-ha", created_by: "u-ha" } }],
    ["the meeting is online", { over: { venue: "online" } }],
    ["the capabilities cannot be read", { capsFail: true }],
    ["the roster cannot be read", { rosterFail: () => true }],
  ] as const)("sends the viewer back to the meeting when %s", async (_why, opts) => {
    route(opts);
    const onBack = renderView(memoryRecordingStore());
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Đang ghi âm")).not.toBeInTheDocument();
  });

  it("a refetch error while recording keeps recording", async () => {
    let rosterDown = false;
    route({ rosterFail: () => rosterDown });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onBack = renderView(memoryRecordingStore(), vi.fn(), client);
    await startRecording();

    rosterDown = true;
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.participants("m1") }));
    await waitFor(() => expect(client.getQueryState(meetingKeys.participants("m1"))?.status).toBe("error"));
    expect(screen.getByText("Đang ghi âm")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("holds the start until the device has said what it already holds", async () => {
    const memory = memoryRecordingStore();
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const store: RecordingStore = { ...memory, listParts: async (...args) => (await answered, memory.listParts(...args)) };
    renderView(store);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Tôi đã thông báo cho người dự họp về việc ghi âm/ }));
    const start = screen.getByRole("button", { name: "Bắt đầu ghi âm" });
    expect(start).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(start);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByText("Đang ghi âm")).not.toBeInTheDocument();

    answer();
    await waitFor(() => expect(start).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(start);
    expect(await screen.findByText("Đang ghi âm")).toBeInTheDocument();
  });

  it("ending asks, then sends", async () => {
    const store = memoryRecordingStore();
    const onSent = vi.fn();
    const onBack = renderView(store, vi.fn(), undefined, { onSent });
    await startRecording();

    fireEvent.click(screen.getAllByRole("button", { name: "Kết thúc" })[0]!);
    let confirm = await screen.findByRole("alertdialog", { name: "Kết thúc và gửi bản ghi?" });
    expect(confirm).toHaveTextContent("Bản ghi 0:00 được gửi để Thư ký UNI soạn tóm tắt, việc đề xuất và biên bản.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Ghi tiếp" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Cancelling the end goes on recording: it never pauses.
    expect(screen.getByText("Đang ghi âm")).toBeInTheDocument();
    expect(tracks.at(-1)!.stop).not.toHaveBeenCalled();

    // The bar's red stop asks the same question.
    fireEvent.click(screen.getAllByRole("button", { name: "Kết thúc" }).at(-1)!);
    confirm = await screen.findByRole("alertdialog", { name: "Kết thúc và gửi bản ghi?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Kết thúc và gửi" }));
    expect(await screen.findByRole("dialog", { name: "Đang gửi bản ghi" })).toBeInTheDocument();
    expect(tracks.at(-1)!.stop).toHaveBeenCalled();
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(transcriptionPosts()).toHaveLength(1);
    expect(await store.listParts(USER.id, "m1")).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("the interrupted panel's end asks the same question", async () => {
    renderView(memoryRecordingStore());
    await startRecording();
    act(() => void tracks.at(-1)!.dispatchEvent(new Event("ended")));
    fireEvent.click(await screen.findByRole("button", { name: "Kết thúc và gửi" }));
    expect(await screen.findByRole("alertdialog", { name: "Kết thúc và gửi bản ghi?" })).toBeInTheDocument();
  });

  it("send=1 sends what is on the device", async () => {
    const store = memoryRecordingStore();
    await storedPart(store);
    const onSent = vi.fn();
    const onBack = renderView(store, vi.fn(), undefined, { send: true, onSent });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Bắt đầu ghi âm" })).not.toBeInTheDocument();
    expect(transcriptionPosts()).toHaveLength(1);
    expect(await store.listParts(USER.id, "m1")).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("send=1 with nothing on the device goes back to the meeting", async () => {
    const onSent = vi.fn();
    const onBack = renderView(memoryRecordingStore(), vi.fn(), undefined, { send: true, onSent });
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(onSent).not.toHaveBeenCalled();
    expect(transcriptionPosts()).toHaveLength(0);
  });

  it("stopping the send keeps the recording on the device and goes back", async () => {
    // The part PUT hangs until the upload is cancelled.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      ),
    );
    const store = memoryRecordingStore();
    await storedPart(store);
    const onBack = renderView(store, vi.fn(), undefined, { send: true });
    const stop = await screen.findByRole("button", { name: "Dừng gửi" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // Closing the tab mid-upload asks first.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    fireEvent.click(stop);
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(await store.listParts(USER.id, "m1")).toHaveLength(1);
    expect(transcriptionPosts()).toHaveLength(0);
  });

  it("the breadcrumb is no way out while recording", async () => {
    renderView(memoryRecordingStore());
    await startRecording();
    expect(screen.queryByRole("link", { name: "Cuộc họp" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Cuộc họp" })).getByText("Cuộc họp")).toBeInTheDocument();
  });

  it("the end question stays open until the recording is saved", async () => {
    const memory = memoryRecordingStore();
    let save: () => void = () => {};
    const saved = new Promise<void>((resolve) => (save = resolve));
    const store: RecordingStore = { ...memory, finishPart: async (...args) => (await saved, memory.finishPart(...args)) };
    renderView(store);
    await startRecording();
    fireEvent.click(screen.getAllByRole("button", { name: "Kết thúc" })[0]!);
    const confirm = await screen.findByRole("alertdialog", { name: "Kết thúc và gửi bản ghi?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Kết thúc và gửi" }));
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Kết thúc và gửi" })).toHaveAttribute("aria-busy", "true"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole("alertdialog", { name: "Kết thúc và gửi bản ghi?" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Đang gửi bản ghi" })).not.toBeInTheDocument();

    save();
    expect(await screen.findByRole("dialog", { name: "Đang gửi bản ghi" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("leaves once, and never reports a send it stopped", async () => {
    // The part PUT hangs until the upload is cancelled.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      ),
    );
    const store = memoryRecordingStore();
    await storedPart(store);
    const onSent = vi.fn();
    const onBack = renderView(store, vi.fn(), undefined, { send: true, onSent });
    const stop = await screen.findByRole("button", { name: "Dừng gửi" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(stop);
    fireEvent.click(stop);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSent).not.toHaveBeenCalled();
  });
});

