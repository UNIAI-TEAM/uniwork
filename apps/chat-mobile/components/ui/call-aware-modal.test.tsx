import { act, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { callEngine } from "@/data/calls/call-store";
import type { VoiceCallState } from "@/lib/voice-call";
import { render } from "@/test/render";
import { CallAwareModal } from "./call-aware-modal";

const ringing: VoiceCallState = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Bình", callKind: "dm" };
const setCall = (call: VoiceCallState) => act(() => callEngine.store.setState({ call }));

afterEach(async () => {
  await setCall({ status: "idle" });
});

describe("CallAwareModal (audit C2)", () => {
  it("closes an open sheet when a call starts ringing, once", async () => {
    const close = jest.fn();
    await render(
      <CallAwareModal visible transparent onRequestClose={close}>
        <Text>sheet</Text>
      </CallAwareModal>,
    );
    expect(screen.getByText("sheet")).toBeOnTheScreen();
    await setCall(ringing);
    expect(close).toHaveBeenCalledTimes(1);
    // Still ringing (a re-render of the same state): not again.
    await setCall({ ...ringing });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves a closed sheet, and an open one through a call the person makes, alone", async () => {
    const closed = jest.fn();
    const open = jest.fn();
    await render(
      <>
        <CallAwareModal visible={false} onRequestClose={closed}>
          <Text>hidden</Text>
        </CallAwareModal>
        <CallAwareModal onRequestClose={open}>
          <Text>open</Text>
        </CallAwareModal>
      </>,
    );
    await setCall({ status: "ringing", callId: "c-2", roomId: "r-1", peerName: "Bình", outgoing: true, callKind: "dm" });
    expect(open).not.toHaveBeenCalled();
    await setCall(ringing);
    expect(closed).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("stays open when the call it belongs to rings (the answer's microphone primer), and closes for any other", async () => {
    const close = jest.fn();
    await render(
      <CallAwareModal visible keepOpenForCall="c-1" onRequestClose={close}>
        <Text>primer</Text>
      </CallAwareModal>,
    );
    await setCall(ringing);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText("primer")).toBeOnTheScreen();
    await setCall({ status: "idle" });
    await setCall({ ...ringing, callId: "c-2" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not need a close handler", async () => {
    await render(
      <CallAwareModal visible>
        <Text>bare</Text>
      </CallAwareModal>,
    );
    await setCall(ringing);
    expect(screen.getByText("bare")).toBeOnTheScreen();
  });
});
