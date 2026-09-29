import { act, render, screen } from "@testing-library/react";
import { Suspense, startTransition, use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { encodeSignal } from "./meeting-signals";
import { MeetingSignalsProvider, useParticipantSignal, useRequestMute } from "./use-meeting-signals";

type DataMessage = { payload: Uint8Array; from?: { identity: string } };

const lk = vi.hoisted(() => ({
  onData: null as null | ((msg: DataMessage) => void),
  micEnabled: true,
  toggle: vi.fn(),
  participants: [{ identity: "me" }, { identity: "lan" }, { identity: "minh" }],
  sent: [] as Uint8Array[],
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({
  // Like @livekit/components-core: a new callback builds a new channel, and its
  // send throws until the hook's effect has subscribed to that channel.
  useDataChannel: (_topic: string, cb: (msg: DataMessage) => void) => {
    lk.onData = cb;
    const channel = useMemo(() => {
      const ch = {
        onMessage: cb,
        subscribed: false,
        send: async (payload: Uint8Array) => {
          if (!ch.subscribed) throw new TypeError("Cannot read properties of undefined (reading 'next')");
          lk.sent.push(payload);
        },
      };
      return ch;
    }, [cb]);
    useEffect(() => {
      channel.subscribed = true;
    }, [channel]);
    return { send: channel.send };
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
  lk.sent = [];
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.success).mockClear();
});

function HandProbe({ identity }: { identity: string }) {
  const { handRaised } = useParticipantSignal(identity);
  return <span data-testid={`hand-${identity}`}>{handRaised ? "up" : "down"}</span>;
}

function MuteProbe({ target }: { target: string }) {
  const requestMute = useRequestMute();
  return (
    <button type="button" onClick={() => requestMute(target, "Lan")}>
      mute
    </button>
  );
}

describe("MeetingSignalsProvider", () => {
  it("sends the host's mute request after a render the room threw away", async () => {
    const never = new Promise<never>(() => {});
    function Suspender({ on }: { on: boolean }) {
      if (on) use(never);
      return null;
    }
    let next: () => void = () => {};
    function Room() {
      const [step, setStep] = useState(0);
      next = () => startTransition(() => setStep(1));
      return (
        <Suspense fallback={null}>
          <MeetingSignalsProvider canHost hostIdentities={[`me-${step}`]}>
            <MuteProbe target="lan" />
            <Suspender on={step === 1} />
          </MeetingSignalsProvider>
        </Suspense>
      );
    }
    render(<Room />);
    // A transition renders the provider again, then suspends: React keeps the
    // committed tree and discards that render.
    act(() => next());
    await act(async () => screen.getByRole("button", { name: "mute" }).click());
    expect(lk.sent.map((p) => new TextDecoder().decode(p))).toEqual([
      new TextDecoder().decode(encodeSignal({ kind: "mute_request", target: "lan" })),
    ]);
    // The host hears back by name once the request has left.
    expect(toast.success).toHaveBeenCalledWith("Đã tắt mic của Lan", { position: "top-center" });
  });

  it("tells the viewer when the host muted them, instead of muting silently", () => {
    render(
      <MeetingSignalsProvider hostIdentities={["host"]}>
        <span />
      </MeetingSignalsProvider>,
    );
    act(() => lk.onData?.({ payload: encodeSignal({ kind: "mute_request", target: "me" }), from: { identity: "host" } }));
    expect(lk.toggle).toHaveBeenCalledWith(false);
    expect(toast.info).toHaveBeenCalledWith(
      "Chủ trì đã tắt mic của bạn",
      expect.objectContaining({ position: "top-center", action: expect.objectContaining({ label: "Bật mic" }) }),
    );
    // The way back sits on the notice itself.
    const options = vi.mocked(toast.info).mock.calls[0]![1] as unknown as { action: { onClick: () => void } };
    options.action.onClick();
    expect(lk.toggle).toHaveBeenLastCalledWith(true);
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
