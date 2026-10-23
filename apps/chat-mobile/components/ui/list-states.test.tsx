// The list screens' loading and error states (list-states.tsx): row outlines
// read as one "loading" element, and an error that names what failed, is
// announced as it appears (VoiceOver through useAnnounce, TalkBack through its
// live region) and retries.
import { fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { render, viText } from "@/test/render";
import { ListLoadError, ListSkeleton } from "./list-states";

afterEach(() => {
  Platform.OS = "ios";
  jest.restoreAllMocks();
});

describe("ListSkeleton", () => {
  it("reads as one progress element, named by the screen or as loading", async () => {
    const { unmount } = await render(<ListSkeleton testID="skeleton" />);
    expect(screen.getByRole("progressbar", { name: viText("common.loading") })).toBeOnTheScreen();
    await unmount();
    await render(<ListSkeleton square label={viText("chat.loading_members")} />);
    expect(screen.getByRole("progressbar", { name: viText("chat.loading_members") })).toBeOnTheScreen();
  });
});

describe("ListLoadError", () => {
  it("names what failed and what to try, is announced on iOS, and retries", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const onRetry = jest.fn();
    const title = viText("mobile.lists.contacts_load_failed");
    await render(<ListLoadError title={title} onRetry={onRetry} testID="error" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveProp("accessibilityLiveRegion", "assertive");
    expect(screen.getByText(title)).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.lists.load_failed_hint"))).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(`${title}. ${viText("mobile.lists.load_failed_hint")}`);
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
