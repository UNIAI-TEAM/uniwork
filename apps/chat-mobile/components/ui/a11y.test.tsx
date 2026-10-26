// The screen-reader helpers: VoiceOver hears what Android's live regions say,
// once per change, and the screen-reader switch is followed while open.
import { act, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, Platform, Text } from "react-native";
import { render } from "@/test/render";
import { useAnnounce, useLargeText, useReduceMotion, useScreenReaderEnabled } from "./a11y";

function Say({ line }: { line: string | null }) {
  useAnnounce(line);
  return null;
}

function Motion() {
  return <Text>{useReduceMotion() ? "still" : "moving"}</Text>;
}

function Size() {
  return <Text>{useLargeText() ? "large" : "default"}</Text>;
}

function Reader() {
  return <Text>{useScreenReaderEnabled() ? "on" : "off"}</Text>;
}

// React Native's preset already makes announceForAccessibility a mock: clear what earlier tests said.
beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  Platform.OS = "ios";
  jest.restoreAllMocks();
});

describe("useAnnounce", () => {
  it("says a line on iOS when it appears or changes, once each, and again after it went away", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { rerender } = await render(<Say line={null} />);
    await rerender(<Say line="Đang chờ mạng…" />);
    await rerender(<Say line="Đang chờ mạng…" />);
    await rerender(<Say line="Đang kết nối…" />);
    await rerender(<Say line={null} />);
    await rerender(<Say line="Đang kết nối…" />);
    expect(announce.mock.calls).toEqual([["Đang chờ mạng…"], ["Đang kết nối…"], ["Đang kết nối…"]]);
  });

  it("leaves Android to the live region", async () => {
    Platform.OS = "android";
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await render(<Say line="Đang chờ mạng…" />);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("useScreenReaderEnabled", () => {
  it("reads the switch and follows it", async () => {
    let changed: (on: boolean) => void = () => undefined;
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((_event: string, handler: (on: boolean) => void) => {
      changed = handler;
      return { remove: jest.fn() };
    }) as never);
    const { unmount } = await render(<Reader />);
    await act(async () => undefined);
    expect(screen.getByText("on")).toBeOnTheScreen();
    await act(async () => changed(false));
    expect(screen.getByText("off")).toBeOnTheScreen();
    await unmount();
  });
});

describe("useReduceMotion", () => {
  it("starts still, reads the switch and follows it", async () => {
    let changed: (on: boolean) => void = () => undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((_event: string, handler: (on: boolean) => void) => {
      changed = handler;
      return { remove: jest.fn() };
    }) as never);
    const { unmount } = await render(<Motion />);
    await act(async () => undefined);
    expect(screen.getByText("moving")).toBeOnTheScreen();
    await act(async () => changed(true));
    expect(screen.getByText("still")).toBeOnTheScreen();
    await unmount();
  });

  it("stays still when the platform cannot tell, and ignores an answer after unmount", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockRejectedValue(new Error("unsupported"));
    await render(<Motion />);
    await act(async () => undefined);
    expect(screen.getByText("still")).toBeOnTheScreen();
    let answer: (on: boolean) => void = () => undefined;
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { unmount } = await render(<Motion />);
    await unmount();
    await act(async () => answer(false));
  });
});

describe("useLargeText", () => {
  const scale = (fontScale: number) => jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });

  it("is off at the default and the larger standard sizes", async () => {
    scale(1.3);
    await render(<Size />);
    expect(screen.getByText("default")).toBeOnTheScreen();
  });

  it("is on from the first accessibility size", async () => {
    scale(2);
    await render(<Size />);
    expect(screen.getByText("large")).toBeOnTheScreen();
  });
});
