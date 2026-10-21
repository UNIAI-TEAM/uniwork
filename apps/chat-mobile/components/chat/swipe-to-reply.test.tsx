// Swipe to reply (swipe-to-reply.tsx): off, the bubble is drawn as it is; the
// arrow behind a swiped bubble ticks once each time the drag crosses the reply threshold.
import "react-native-gesture-handler/jestSetup";
import { act, screen } from "@testing-library/react-native";
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
  // The swipeable itself runs on the gesture runtime, which Jest cannot drive whole (its own callbacks mix
  // worklets and JS); the threshold arrow is tested on its own below, the drag on a device.
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
});
