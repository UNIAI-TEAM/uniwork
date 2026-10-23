// The app icon on the sign-in screen (unichat-logo.tsx): its size, rounded like the home screen's mask.
import { render, screen } from "@testing-library/react-native";
import { UniChatLogo } from "./unichat-logo";

describe("UniChatLogo", () => {
  it("draws at 72 by default and at the size asked, with the mask's corner", async () => {
    const { rerender } = await render(<UniChatLogo />);
    expect(screen.root?.props.style).toEqual({ width: 72, height: 72, borderRadius: 16 });
    await rerender(<UniChatLogo size={40} />);
    expect(screen.root?.props.style).toEqual({ width: 40, height: 40, borderRadius: 9 });
  });
});
