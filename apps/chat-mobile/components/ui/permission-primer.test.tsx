// The permission primer (data/permissions.ts): what it says for each
// permission and reason, and the answer each button gives — after the sheet
// is gone on iOS, so the system prompt that follows can show.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type React from "react";
import { Platform } from "react-native";
import { presentPrimer, usePrimerStore } from "@/data/stores/permission-primer-store";
import type { PrimerRequest } from "@/data/permissions";
import { render, viText } from "@/test/render";
import { PermissionPrimerHost } from "./permission-primer";

/** Shows the primer; the answer comes back wrapped, so awaiting the show does not wait for it. */
async function show(request: PrimerRequest): Promise<{ answer: Promise<boolean> }> {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = presentPrimer(request);
  });
  return { answer };
}

// The sheet as iOS runs it: onDismiss once a visible sheet has closed, and a
// way to press Android's back button (the Modal's onRequestClose).
jest.mock("./call-aware-modal", () => {
  const { useEffect, useRef } = jest.requireActual<typeof import("react")>("react");
  const { Platform: platform, Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CallAwareModal: ({ visible, onDismiss, onRequestClose, keepOpenForCall, children }: { visible: boolean; onDismiss?: () => void; onRequestClose?: () => void; keepOpenForCall?: string; children: React.ReactNode }) => {
      const was = useRef(visible);
      useEffect(() => {
        if (was.current && !visible && platform.OS === "ios") onDismiss?.();
        was.current = visible;
      }, [visible, onDismiss]);
      return visible ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => onRequestClose?.()}>
            <Text>system back</Text>
          </Pressable>
          {keepOpenForCall ? <Text>{`stays for ${keepOpenForCall}`}</Text> : null}
          {children}
        </>
      ) : null;
    },
  };
});

afterEach(async () => {
  await act(async () => usePrimerStore.setState({ request: null }));
});

describe("PermissionPrimerHost", () => {
  it("draws nothing until a permission is asked for", async () => {
    await render(<PermissionPrimerHost />);
    expect(screen.queryByTestId("permission-primer-continue")).toBeNull();
  });

  it.each([
    [{ kind: "microphone", reason: "voice", step: "prime" }, "mobile.permissions.microphone_title", "mobile.permissions.microphone_voice_body", "mobile.permissions.continue"],
    [{ kind: "microphone", reason: "call", step: "prime" }, "mobile.permissions.microphone_title", "mobile.permissions.microphone_call_body", "mobile.permissions.continue"],
    [{ kind: "camera", reason: "video", step: "prime" }, "mobile.permissions.camera_title", "mobile.permissions.camera_body", "mobile.permissions.continue"],
    [{ kind: "notifications", reason: "notifications", step: "prime" }, "mobile.permissions.notifications_title", "mobile.permissions.notifications_body", "mobile.permissions.continue"],
    [{ kind: "camera", reason: "video", step: "settings" }, "mobile.permissions.camera_title", "mobile.permissions.camera_denied", "mobile.permissions.open_settings"],
  ] as const)("explains %j", async (request, title, body, primary) => {
    await render(<PermissionPrimerHost />);
    await show(request);
    expect(screen.getByRole("header", { name: viText(title) })).toBeOnTheScreen();
    expect(screen.getByText(viText(body))).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: viText(primary) })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: viText("mobile.permissions.not_now") })).toBeOnTheScreen();
  });

  it("stays over the ringing screen of the call it asks for, and only that call", async () => {
    await render(<PermissionPrimerHost />);
    await show({ kind: "microphone", reason: "call", step: "prime", callId: "c-9" });
    expect(screen.getByText("stays for c-9", { includeHiddenElements: true })).toBeOnTheScreen();
    await show({ kind: "microphone", reason: "voice", step: "prime" });
    expect(screen.queryByText(/stays for/, { includeHiddenElements: true })).toBeNull();
  });

  it("on iOS answers once the sheet is gone: yes for Continue, no for Not now", async () => {
    Platform.OS = "ios";
    await render(<PermissionPrimerHost />);
    const { answer: yes } = await show({ kind: "microphone", reason: "voice", step: "prime" });
    await fireEvent.press(screen.getByTestId("permission-primer-continue"));
    await expect(yes).resolves.toBe(true);
    expect(screen.queryByTestId("permission-primer-continue")).toBeNull();

    const { answer: no } = await show({ kind: "camera", reason: "video", step: "prime" });
    await fireEvent.press(screen.getByTestId("permission-primer-later"));
    await expect(no).resolves.toBe(false);
  });

  it("on Android answers at once, and the back button is a no", async () => {
    Platform.OS = "android";
    await render(<PermissionPrimerHost />);
    const { answer: yes } = await show({ kind: "notifications", reason: "notifications", step: "prime" });
    await fireEvent.press(screen.getByTestId("permission-primer-continue"));
    await expect(yes).resolves.toBe(true);

    const { answer: back } = await show({ kind: "notifications", reason: "notifications", step: "prime" });
    await fireEvent.press(screen.getByText("system back", { includeHiddenElements: true }));
    await expect(back).resolves.toBe(false);
    Platform.OS = "ios";
  });
});
