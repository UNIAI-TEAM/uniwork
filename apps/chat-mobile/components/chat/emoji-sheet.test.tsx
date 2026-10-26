// "More reactions" (emoji-sheet.tsx): a fixed grid of emoji, each a button
// named by itself; a tap picks it.
import { fireEvent, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { EmojiSheet } from "./emoji-sheet";

describe("EmojiSheet", () => {
  it("offers 36 emoji under its heading and picks the one tapped", async () => {
    const onPick = jest.fn();
    await render(<EmojiSheet visible onClose={jest.fn()} onPick={onPick} />);
    expect(screen.getByRole("header", { name: viText("chat.action_react_more") })).toBeOnTheScreen();
    expect(screen.getAllByRole("button").filter((b) => b.props.accessibilityLabel !== viText("common.close"))).toHaveLength(36);
    await fireEvent.press(screen.getByRole("button", { name: "🚀" }));
    expect(onPick).toHaveBeenCalledWith("🚀");
  });
});
