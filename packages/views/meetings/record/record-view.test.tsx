import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
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
    this.onstop?.();
  }
}

function route({
  transcription = true,
  over = {},
  capsFail = false,
}: { transcription?: boolean; over?: Partial<Meeting>; capsFail?: boolean } = {}) {
  requestMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/meetings/m1") return { meeting: { ...meeting, ...over } };
    if (path === "/api/v1/meetings/m1/participants") {
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

function renderView(store: RecordingStore, onBack = vi.fn()) {
  render(
    wrapWithNav(
      <MeetingRecordView workspaceId="w1" meetingId="m1" store={store} onBack={onBack} onSent={vi.fn()} meetingsHref="/o/w/meetings" />,
    ),
  );
  return onBack;
}

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
  ] as const)("sends the viewer back to the meeting when %s", async (_why, opts) => {
    route(opts);
    const onBack = renderView(memoryRecordingStore());
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Đang ghi âm")).not.toBeInTheDocument();
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
});
