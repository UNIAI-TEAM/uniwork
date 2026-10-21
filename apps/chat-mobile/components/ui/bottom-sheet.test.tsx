// The app's bottom sheet (bottom-sheet.tsx): a drag down past its share or a
// flick closes it, a short drag springs back, and VoiceOver's escape, the
// backdrop and (for a question) not the backdrop; a sheet whose body scrolls
// drags from its grabber, and one with a text field rides the keyboard.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { render, viText } from "@/test/render";
import { BottomSheet, type BottomSheetProps } from "./bottom-sheet";

const drag = async (translationY: number, velocityY: number) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId("sheet-drag"), [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: translationY / 2, velocityY },
      { state: State.ACTIVE, translationY, velocityY },
      { state: State.END, translationY, velocityY },
    ] as never);
  });
};

async function open(extra: Partial<BottomSheetProps> = {}) {
  const onClose = jest.fn();
  await render(
    <BottomSheet visible onClose={onClose} testID="sheet" {...extra}>
      <Text>body</Text>
    </BottomSheet>,
  );
  return onClose;
}

afterEach(() => jest.restoreAllMocks());

describe("BottomSheet", () => {
  it("closes on a long drag down and springs back from a short one", async () => {
    const onClose = await open();
    await drag(40, 100);
    expect(onClose).not.toHaveBeenCalled();
    await drag(200, 300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a downward flick, and springs back without motion for someone who asked for less", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const onClose = await open();
    await act(async () => undefined);
    await drag(30, 100);
    expect(onClose).not.toHaveBeenCalled();
    await drag(30, 2000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the backdrop and from VoiceOver's escape gesture", async () => {
    const onClose = await open({ above: <Text>above</Text> });
    expect(screen.getByText("above")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("common.close") }));
    await fireEvent(screen.getByTestId("sheet"), "accessibilityEscape");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps a question open on a backdrop tap: it has no close button there", async () => {
    await open({ backdropCloses: false });
    expect(screen.queryByRole("button", { name: viText("common.close") })).toBeNull();
    expect(screen.getByText("body")).toBeOnTheScreen();
  });

  it("drags a scrolling sheet from its grabber, and rides the keyboard when it has a field", async () => {
    const onClose = await open({ dragFrom: "handle", avoidKeyboard: true, keyboardClassName: "max-h-[92%]" });
    expect(screen.getByTestId("sheet-grabber", { includeHiddenElements: true })).toBeTruthy();
    await drag(400, 0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("measures the panel, so a short sheet closes at its share of the height", async () => {
    const onClose = await open({ sizeClassName: "max-h-[60%]", fill: true });
    await fireEvent(screen.getByTestId("sheet-panel"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 150 } } });
    await drag(70, 0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
