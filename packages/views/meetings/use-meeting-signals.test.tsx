import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { encodeSignal } from "./meeting-signals";
import { MeetingSignalsProvider, useParticipantSignal } from "./use-meeting-signals";

type DataMessage = { payload: Uint8Array; from?: { identity: string } };

const lk = vi.hoisted(() => ({
  onData: null as null | ((msg: DataMessage) => void),
  micEnabled: true,
  toggle: vi.fn(),
  participants: [{ identity: "me" }, { identity: "lan" }, { identity: "minh" }],
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({
  useDataChannel: (_topic: string, cb: (msg: DataMessage) => void) => {
    lk.onData = cb;
    return { send: vi.fn() };
  },
  useLocalParticipant: () => ({ localParticipant: { identity: "me" } }),
  useParticipants: () => lk.participants,
  useTrackToggle: () => ({ enabled: lk.micEnabled, toggle: lk.toggle }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  lk.onData = null;
  lk.micEnabled = true;
  lk.toggle.mockClear();
  vi.mocked(toast.info).mockClear();
});

function HandProbe({ identity }: { identity: string }) {
  const { handRaised } = useParticipantSignal(identity);
  return <span data-testid={`hand-${identity}`}>{handRaised ? "up" : "down"}</span>;
}

describe("MeetingSignalsProvider", () => {
  it("tells the viewer when the host muted them, instead of muting silently", () => {
    render(
      <MeetingSignalsProvider hostIdentities={["host"]}>
        <span />
      </MeetingSignalsProvider>,
    );
    act(() => lk.onData?.({ payload: encodeSignal({ kind: "mute_request", target: "me" }), from: { identity: "host" } }));
    expect(lk.toggle).toHaveBeenCalledWith(false);
    expect(toast.info).toHaveBeenCalledWith("Chủ trì đã tắt micro của bạn", expect.anything());
  });

  it("ignores a mute request from someone who is not a host", () => {
    render(
      <MeetingSignalsProvider hostIdentities={["host"]}>
        <span />
      </MeetingSignalsProvider>,
    );
    act(() => lk.onData?.({ payload: encodeSignal({ kind: "mute_request", target: "me" }), from: { identity: "x" } }));
    expect(lk.toggle).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("gives each participant only their own hand state", () => {
    render(
      <MeetingSignalsProvider>
        <HandProbe identity="lan" />
        <HandProbe identity="minh" />
      </MeetingSignalsProvider>,
    );
    act(() => lk.onData?.({ payload: encodeSignal({ kind: "hand", value: true }), from: { identity: "lan" } }));
    expect(screen.getByTestId("hand-lan")).toHaveTextContent("up");
    expect(screen.getByTestId("hand-minh")).toHaveTextContent("down");
  });
});
