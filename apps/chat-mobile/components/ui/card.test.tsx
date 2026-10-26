// CardPressable (card.tsx): a pressable card that keeps its continuous corners
// whether its style is an object or a function of the press state.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { continuousCorners } from "@/lib/radius";
import { CardPressable } from "./card";

describe("CardPressable", () => {
  it("presses, with the corners before a style object", async () => {
    const onPress = jest.fn();
    await render(
      <CardPressable accessibilityRole="button" onPress={onPress} style={{ margin: 4 }}>
        <Text>Acme</Text>
      </CardPressable>,
    );
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveStyle({ margin: 4, ...continuousCorners });
  });

  it("keeps the corners when the style follows the press state", async () => {
    const style = jest.fn(({ pressed }: { pressed: boolean }) => ({ opacity: pressed ? 0.5 : 1 }));
    await render(<CardPressable accessibilityRole="button" style={style} />);
    expect(style).toHaveBeenCalledWith(expect.objectContaining({ pressed: false }));
    expect(screen.getByRole("button")).toHaveStyle({ opacity: 1, ...continuousCorners });
    expect(CardPressable.displayName).toBe("CardPressable");
  });
});
