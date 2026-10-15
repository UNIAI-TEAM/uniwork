import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../test/api-mock";
import { useVoiceCallRecording } from "./use-voice-call-recording";

const toastMock = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

let reconnect: (() => void) | null = null;
const fakeWs = {
  on: () => () => undefined,
  onReconnect: (callback: () => void) => {
    reconnect = callback;
    return () => {
      reconnect = null;
    };
  },
};

vi.mock("@uniwork/core/realtime", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/realtime")>()),
  useOptionalWS: () => ({ client: fakeWs }),
}));

const ACTIVE = { recording: { id: "rec1", status: "ACTIVE", started_by: "peer" } };

/** Answers each GET /voice/recording/active with the next queued reply. */
function queueActive(...replies: Array<unknown>) {
  requestMock.mockImplementation(async (path: string) => {
    if (!path.includes("/voice/recording/active")) return {};
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return next;
  });
}

function activeCalls(): number {
  return requestMock.mock.calls.filter((call) => String(call[0]).includes("/voice/recording/active")).length;
}

function renderRecording() {
  return renderHook(() => useVoiceCallRecording({ workspaceId: "ws1", roomId: "room1", callId: "call1" }), {
    wrapper: ({ children }) => wrap(<>{children}</>),
  });
}

beforeEach(() => {
  reconnect = null;
  requestMock.mockReset();
  toastMock.warning.mockReset();
});

describe("useVoiceCallRecording", () => {
  it("re-reads the recording state when the socket reconnects", async () => {
    queueActive({}, ACTIVE);
    const { result } = renderRecording();
    await waitFor(() => expect(activeCalls()).toBe(1));
    expect(result.current.recording).toBe(false);

    await act(async () => {
      reconnect?.();
    });

    await waitFor(() => expect(result.current.recording).toBe(true));
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("clears the badge when the recording stopped while offline", async () => {
    queueActive(ACTIVE, {});
    const { result } = renderRecording();
    await waitFor(() => expect(result.current.recording).toBe(true));
    toastMock.warning.mockReset();

    await act(async () => {
      reconnect?.();
    });

    await waitFor(() => expect(result.current.recording).toBe(false));
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("keeps the current state when the re-read fails", async () => {
    queueActive(ACTIVE, new Error("offline"));
    const { result } = renderRecording();
    await waitFor(() => expect(result.current.recording).toBe(true));

    await act(async () => {
      reconnect?.();
    });

    await waitFor(() => expect(activeCalls()).toBe(2));
    expect(result.current.recording).toBe(true);
  });
});
