import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../test/api-mock";
import { ChatVoiceCallHost, useChatVoiceCall } from "./chat-voice-call-host";
import type { VoiceCapturePrep } from "./voice-call-media";

const prepareVoiceCapture = vi.fn<() => Promise<VoiceCapturePrep>>();

vi.mock("./voice-call-media", async (orig) => ({
  ...(await orig<typeof import("./voice-call-media")>()),
  prepareVoiceCapture: () => prepareVoiceCapture(),
}));

vi.mock("../layout/workspace-context", async (orig) => ({
  ...(await orig<typeof import("../layout/workspace-context")>()),
  useWorkspace: () => ({ workspace: { id: "ws1" }, user: { id: "me" } }),
}));

// The panel is not under test; keep LiveKit out of the render.
vi.mock("./voice-call-overlay", () => ({ VoiceCallOverlay: () => null }));

function invites(): string[] {
  return requestMock.mock.calls.map((call) => String(call[0])).filter((path) => path.includes("/voice/invite"));
}

let call: ReturnType<typeof useChatVoiceCall>["startCall"] = async () => false;

function Caller() {
  call = useChatVoiceCall().startCall;
  return null;
}

function renderHost() {
  render(
    wrap(
      <ChatVoiceCallHost>
        <Caller />
      </ChatVoiceCallHost>,
    ),
  );
}

beforeEach(() => {
  prepareVoiceCapture.mockReset();
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) =>
    path.includes("/voice/pending") ? { invites: [] } : { status: "ok" },
  );
});

describe("ChatVoiceCallHost", () => {
  it("rings once when Call is pressed twice before the first invite returns", async () => {
    const grants: ((prep: VoiceCapturePrep) => void)[] = [];
    prepareVoiceCapture.mockImplementation(() => new Promise((resolve) => grants.push(resolve)));
    renderHost();

    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = call("room-dm", "Long", "dm");
      second = call("room-dm", "Long", "dm");
    });
    await act(async () => {
      for (const grant of grants) grant({ ok: true });
      await Promise.all([first, second]);
    });

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(invites()).toHaveLength(1);
  });

  it("lets Call start again once a call that failed to start is over", async () => {
    prepareVoiceCapture.mockResolvedValueOnce({ ok: false, device: { kind: "audioinput", failure: "denied" } });
    prepareVoiceCapture.mockResolvedValueOnce({ ok: true });
    renderHost();

    await act(async () => {
      expect(await call("room-dm", "Long", "dm")).toBe(false);
    });
    expect(invites()).toHaveLength(0);

    await act(async () => {
      expect(await call("room-dm", "Long", "dm")).toBe(true);
    });
    await waitFor(() => expect(invites()).toHaveLength(1));
  });
});
