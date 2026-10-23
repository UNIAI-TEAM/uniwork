// Android's ripple (ripple.ts): the content's ink at a low alpha, darker on a
// light screen and lighter on a dark one, round for an icon button.
import { act, renderHook } from "@testing-library/react-native";
import { colorScheme } from "nativewind";
import { useRipple } from "./ripple";

afterEach(() => act(() => colorScheme.set("light")));

describe("useRipple", () => {
  it("ripples in the foreground ink, light and dark, bounded or round", async () => {
    const { result, rerender } = await renderHook(({ round }: { round: boolean }) => useRipple(round), { initialProps: { round: false } });
    expect(result.current).toEqual({ color: "hsla(0, 0%, 12.5%, 0.12)", borderless: false, foreground: false });
    await rerender({ round: true });
    expect(result.current.borderless).toBe(true);
    await act(() => colorScheme.set("dark"));
    expect(result.current.color).toBe("hsla(210, 16.7%, 97.6%, 0.16)");
  });
});
