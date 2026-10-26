// The sign-in illustration (login-hero.tsx): decorative, so a screen reader never reaches it; drawn like an image,
// so its sample bubbles keep their text size; and at the accessibility text sizes only the mark is left, so the
// welcome, the hint and the button get the screen (iOS AX5 drew the bubbles over the mark and the title).
import { screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { render, viText } from "@/test/render";
import { LoginHero } from "./login-hero";

const hidden = { includeHiddenElements: true } as const;
const fontScale = (scale: number) => jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: scale });

afterEach(() => jest.restoreAllMocks());

describe("LoginHero", () => {
  it("is hidden from screen readers and keeps every sample line at its own size at the default text size", async () => {
    await render(<LoginHero />);
    const stage = screen.getByTestId("login-hero", hidden);
    expect(stage.props.accessibilityElementsHidden).toBe(true);
    expect(stage.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.queryByText(viText("chat.mobile.login_sample_in"))).toBeNull();
    expect(screen.getByText(viText("chat.mobile.login_sample_in"), hidden)).toBeTruthy();
    const lines = [
      viText("chat.video_call_log_completed", { duration: "3:05" }),
      "Nguyễn Thu Hà",
      viText("chat.mobile.login_sample_in"),
      viText("chat.mobile.login_sample_out"),
      "10:31",
    ].map((line) => screen.getByText(line, hidden));
    expect(lines.every((node) => node.props.allowFontScaling === false)).toBe(true);
  });

  it("keeps the stage below the accessibility sizes, where the system text has grown but not yet stacked", async () => {
    fontScale(1.35);
    await render(<LoginHero />);
    expect(screen.getByTestId("login-hero", hidden)).toBeTruthy();
    expect(screen.queryByTestId("login-hero-compact", hidden)).toBeNull();
  });

  it("gives way to the mark alone at the accessibility text sizes, still hidden from screen readers", async () => {
    fontScale(3.57);
    await render(<LoginHero />);
    expect(screen.queryByTestId("login-hero", hidden)).toBeNull();
    const compact = screen.getByTestId("login-hero-compact", hidden);
    expect(compact.props.accessibilityElementsHidden).toBe(true);
    expect(compact.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.queryByText(viText("chat.mobile.login_sample_in"), hidden)).toBeNull();
  });
});
