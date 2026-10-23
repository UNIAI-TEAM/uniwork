// A hand-built control's touch contract (tap-target.ts): the hit slop that
// makes up the platform's minimum target (44 pt iOS, 48 dp Android) for the
// size it is drawn at, and Android's ripple, bounded or round.
import { renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";
import { useTapTarget } from "./tap-target";

const os = Platform.OS;
afterEach(() => {
  Platform.OS = os;
});

describe("useTapTarget", () => {
  it.each([
    ["android", 44, 2],
    ["ios", 44, 0],
    ["android", 28, 10],
    ["ios", 28, 8],
    ["android", 64, 0],
  ] as const)("on %s, a control drawn %i tall gets %i of slop", async (platform, drawn, slop) => {
    Platform.OS = platform;
    const { result } = await renderHook(() => useTapTarget(drawn));
    expect(result.current.hitSlop).toBe(slop);
    expect(result.current.android_ripple).toEqual(expect.objectContaining({ borderless: false }));
  });

  it("ripples round past a round icon button's glyph", async () => {
    const { result } = await renderHook(() => useTapTarget(44, true));
    expect(result.current.android_ripple.borderless).toBe(true);
  });
});
