// Swipe to reply (swipe-to-reply.tsx): off, the bubble is drawn as it is; the
// arrow behind a swiped bubble ticks once each time the drag crosses the reply threshold.
import "react-native-gesture-handler/jestSetup";
import { act, screen } from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { render } from "@/test/render";
import { REPLY_SWIPE, ReplyAction, SwipeToReply } from "./swipe-to-reply";

let drag: SharedValue<number> | null = null;

function Arrow() {
  const translation = useSharedValue(0);
  drag = translation;
  return <ReplyAction translation={translation} />;
}

const moveTo = async (x: number) => {
  await act(async () => {
    if (drag) drag.value = x;
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

beforeEach(() => jest.clearAllMocks());

describe("SwipeToReply", () => {
  it("draws the bubble as it is when the swipe is off", async () => {
    await render(
      <SwipeToReply enabled={false} onReply={jest.fn()}>
        <Text>bubble</Text>
      </SwipeToReply>,
    );
    expect(screen.getByText("bubble")).toBeOnTheScreen();
  });

  it("ticks once as the drag crosses the threshold, and again on a second crossing", async () => {
    await render(<Arrow />);
    await moveTo(REPLY_SWIPE / 2);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await moveTo(REPLY_SWIPE + 4);
    await moveTo(REPLY_SWIPE + 20);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    await moveTo(10);
    await moveTo(REPLY_SWIPE);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  });

  const swipe = async (translationX: number) => {
    await act(async () => {
      fireGestureHandler(getByGestureTestId("reply-swipe"), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: translationX / 2 },
        { state: State.ACTIVE, translationX },
        { state: State.END, translationX },
      ] as never);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  };

  it("quotes the bubble when a drag lets go past the threshold, and not from a short one", async () => {
    const onReply = jest.fn();
    await render(
      <SwipeToReply enabled onReply={onReply}>
        <Text>bubble</Text>
      </SwipeToReply>,
    );
    expect(screen.getByText("bubble")).toBeOnTheScreen();
    // No arrow until a drag starts: a cell at rest mounts none.
    expect(screen.queryByTestId("reply-arrow")).toBeNull();
    await swipe(REPLY_SWIPE);
    expect(onReply).not.toHaveBeenCalled();
    await swipe(REPLY_SWIPE * 2 + 30);
    expect(onReply).toHaveBeenCalledTimes(1);
    // Settled back at rest, the arrow is gone again.
    expect(screen.queryByTestId("reply-arrow")).toBeNull();
  });

  it("calls the handler the cell has now, not the one it had when the gesture was built", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await render(
      <SwipeToReply enabled onReply={first}>
        <Text>bubble</Text>
      </SwipeToReply>,
    );
    await rerender(
      <SwipeToReply enabled onReply={second}>
        <Text>bubble</Text>
      </SwipeToReply>,
    );
    await swipe(REPLY_SWIPE * 3);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
