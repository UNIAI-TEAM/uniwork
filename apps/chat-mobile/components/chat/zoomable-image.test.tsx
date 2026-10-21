// The viewer's photo gestures (components/chat/zoomable-image.tsx), driven
// through react-native-gesture-handler's test utilities: a double tap and a
// pinch zoom (and hold the pager), a drag on a zoomed photo moves it instead
// of closing, and a long drag at 1x closes the viewer while a short one does not.
import "react-native-gesture-handler/jestSetup";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { useSharedValue } from "react-native-reanimated";
import { render, viText } from "@/test/render";
import { ZoomableImage } from "./zoomable-image";

function Harness({ onDismiss, onZoomChange }: { onDismiss: () => void; onZoomChange: (zoomed: boolean) => void }) {
  const dismissY = useSharedValue(0);
  return <ZoomableImage source={{ uri: "https://x/a.jpg" }} label="a.jpg" width={400} height={800} dismissY={dismissY} onDismiss={onDismiss} onZoomChange={onZoomChange} />;
}

async function setup() {
  const onDismiss = jest.fn();
  const onZoomChange = jest.fn();
  await render(<Harness onDismiss={onDismiss} onZoomChange={onZoomChange} />);
  return { onDismiss, onZoomChange };
}

const gesture = async (id: string, events: Record<string, unknown>[]) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(id), events as never);
  });
};

describe("ZoomableImage", () => {
  it("names the photo and says how to zoom and close it", async () => {
    await setup();
    const image = screen.getByLabelText("a.jpg");
    expect(image.props.accessibilityHint).toBe(viText("mobile.a11y.image_viewer_hint"));
  });

  it("zooms in on a double tap and back out on the next one, holding the pager meanwhile", async () => {
    const { onZoomChange } = await setup();
    await gesture("zoom-double-tap", [{ state: State.BEGAN, x: 300, y: 500 }, { state: State.ACTIVE, x: 300, y: 500 }, { state: State.END, x: 300, y: 500 }]);
    expect(onZoomChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("a.jpg").props.accessibilityValue).toEqual({ text: viText("mobile.a11y.image_zoomed") });
    await gesture("zoom-double-tap", [{ state: State.BEGAN, x: 300, y: 500 }, { state: State.ACTIVE, x: 300, y: 500 }, { state: State.END, x: 300, y: 500 }]);
    expect(onZoomChange).toHaveBeenLastCalledWith(false);
  });

  it("zooms with a pinch, and a drag then moves the photo instead of closing the viewer", async () => {
    const { onZoomChange, onDismiss } = await setup();
    await gesture("zoom-pinch", [
      { state: State.BEGAN, scale: 1, focalX: 200, focalY: 400 },
      { state: State.ACTIVE, scale: 1.5, focalX: 200, focalY: 400 },
      { state: State.ACTIVE, scale: 2, focalX: 200, focalY: 400 },
      { state: State.END, scale: 2, focalX: 200, focalY: 400 },
    ]);
    expect(onZoomChange).toHaveBeenLastCalledWith(true);
    await gesture("zoom-pan", [
      { state: State.BEGAN, translationX: 0, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationX: 10, translationY: 100, velocityY: 2000 },
      { state: State.ACTIVE, translationX: 40, translationY: 300, velocityY: 2000 },
      { state: State.END, translationX: 40, translationY: 300, velocityY: 2000 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a pinch that ends near 1x settles back to the fitted photo", async () => {
    const { onZoomChange } = await setup();
    await gesture("zoom-pinch", [
      { state: State.BEGAN, scale: 1, focalX: 200, focalY: 400 },
      { state: State.ACTIVE, scale: 1.01, focalX: 200, focalY: 400 },
      { state: State.END, scale: 1.01, focalX: 200, focalY: 400 },
    ]);
    expect(onZoomChange).toHaveBeenLastCalledWith(false);
  });

  it("closes on a long drag at 1x and springs back from a short one", async () => {
    const { onDismiss } = await setup();
    await gesture("zoom-pan", [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: 20, velocityY: 100 },
      { state: State.ACTIVE, translationY: 40, velocityY: 100 },
      { state: State.END, translationY: 40, velocityY: 100 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();
    await gesture("zoom-pan", [
      { state: State.BEGAN, translationY: 0, velocityY: 0 },
      { state: State.ACTIVE, translationY: 100, velocityY: 300 },
      { state: State.ACTIVE, translationY: 200, velocityY: 300 },
      { state: State.END, translationY: 200, velocityY: 300 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes from VoiceOver's escape gesture", async () => {
    const { onDismiss } = await setup();
    await fireEvent(screen.getByLabelText("a.jpg"), "accessibilityAction", { nativeEvent: { actionName: "escape" } });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
