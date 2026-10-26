// The recording bars (voice-wave.tsx): they move while the microphone is open,
// and stand still for someone who asked for less motion.
import { act } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { render } from "@/test/render";
import { VoiceWave } from "./voice-wave";

type JsonNode = { props?: { style?: unknown }; children?: (JsonNode | string)[] | null };

/** Every bar's height in the rendered tree (the bars are hidden from screen readers, so walked, not queried). */
function heights(node: JsonNode | JsonNode[] | string | null): number[] {
  if (!node || typeof node === "string") return [];
  if (Array.isArray(node)) return node.flatMap(heights);
  const styles = [node.props?.style].flat(3) as ({ height?: unknown } | undefined)[];
  const own = styles.flatMap((style) => (typeof style?.height === "number" ? [style.height] : []));
  return [...own, ...(node.children ?? []).flatMap(heights)];
}

beforeEach(() => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }));
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("VoiceWave", () => {
  it("moves while recording", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const view = await render(<VoiceWave />);
    await act(async () => undefined);
    const before = heights(view.toJSON() as JsonNode);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(140 * 3);
    });
    expect(heights(view.toJSON() as JsonNode)).not.toEqual(before);
    await view.unmount();
  });

  it("stands still for someone who asked for less motion", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const view = await render(<VoiceWave />);
    await act(async () => undefined);
    const before = heights(view.toJSON() as JsonNode);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(140 * 3);
    });
    expect(heights(view.toJSON() as JsonNode)).toEqual(before);
  });
});
