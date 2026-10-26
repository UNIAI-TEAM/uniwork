import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert, type AlertButton, AccessibilityInfo, Platform } from "react-native";
import { safetyApi } from "@/data/safety-api";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { DmBlockBanner, DmSafetyRows, MemberSafetySheet } from "./room-safety";

jest.mock("@/data/safety-api", () => ({ safetyApi: { report: jest.fn(), block: jest.fn(), unblock: jest.fn(), blockStatus: jest.fn() } }));

const status = jest.mocked(safetyApi.blockStatus);
const person = { userId: "u2", name: "Bình" };
const messages = () => useToastStore.getState().toasts.map((t) => t.message);
const notBlocked = { blocked_by_me: false, blocked_me: false };

/** Presses the confirm's destructive button, as the person would. */
async function confirmAlert() {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => buttons.find((b) => b.style === "destructive")?.onPress?.());
}

beforeEach(() => {
  // ActionSheet runs a choice at once on Android, after iOS reports the modal gone.
  jest.replaceProperty(Platform, "OS", "android");
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  status.mockResolvedValue(notBlocked);
  jest.mocked(safetyApi.block).mockResolvedValue(true);
  jest.mocked(safetyApi.unblock).mockResolvedValue(true);
});
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("DmSafetyRows", () => {
  it("blocks after the web's confirm and goes back to the list, where the DM is gone", async () => {
    await render(<DmSafetyRows wsId="w1" person={person} />);
    expect(await screen.findByRole("button", { name: viText("chat.block_user") })).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.block_dm_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.block_user") }));
    expect(Alert.alert).toHaveBeenCalledWith(viText("chat.block_confirm_title"), viText("chat.block_confirm_description"), expect.any(Array));
    await confirmAlert();
    expect(safetyApi.block).toHaveBeenCalledWith("w1", "u2");
    expect(messages()).toEqual([viText("mobile.safety.blocked", { name: "Bình" })]);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it("says a block that failed and stays", async () => {
    jest.mocked(safetyApi.block).mockResolvedValueOnce(false);
    await render(<DmSafetyRows wsId="w1" person={person} />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.block_user") }));
    await confirmAlert();
    expect(messages()).toEqual([viText("chat.block_failed")]);
    expect(router.dismissAll).not.toHaveBeenCalled();
  });

  it("unblocks without a confirm, and says a failure", async () => {
    status.mockResolvedValue({ blocked_by_me: true, blocked_me: false });
    await render(<DmSafetyRows wsId="w1" person={person} />);
    const unblock = await screen.findByRole("button", { name: viText("chat.unblock_user") });
    expect(screen.getByText(viText("chat.block_active_hint"))).toBeOnTheScreen();
    await fireEvent.press(unblock);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(safetyApi.unblock).toHaveBeenCalledWith("w1", "u2");
    expect(messages()).toEqual([viText("mobile.safety.unblocked", { name: "Bình" })]);
    jest.mocked(safetyApi.unblock).mockRejectedValueOnce(new Error("offline"));
    await fireEvent.press(unblock);
    expect(messages()).toContain(viText("chat.unblock_failed"));
  });

  it("says when the other person blocked, and opens the report for them", async () => {
    status.mockResolvedValue({ blocked_by_me: false, blocked_me: true });
    jest.mocked(safetyApi.report).mockResolvedValue({ id: "r1", status: "open" });
    await render(<DmSafetyRows wsId="w1" person={person} />);
    expect(await screen.findByText(viText("chat.blocked_me_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.report.action_user", { name: "Bình" }) }));
    expect(screen.getByRole("header", { name: viText("mobile.report.title_user", { name: "Bình" }) })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_spam") }));
    // Android's Switch is not a role-queryable host in the test renderer; its label is what TalkBack reads.
    await fireEvent(screen.getByLabelText(viText("mobile.report.also_block", { name: "Bình" })), "valueChange", true);
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(safetyApi.report).toHaveBeenCalledWith("w1", { user_id: "u2", reason: "spam" });
    // Reported and blocked: the DM is gone for the reporter.
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it("a report without a block stays on the details; one who already blocked is not offered it again", async () => {
    status.mockResolvedValue({ blocked_by_me: true, blocked_me: false });
    jest.mocked(safetyApi.report).mockResolvedValue({ id: "r1", status: "open" });
    await render(<DmSafetyRows wsId="w1" person={person} />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.report.action_user", { name: "Bình" }) }));
    expect(screen.queryByLabelText(viText("mobile.report.also_block", { name: "Bình" }))).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.report.reason_other") }));
    await fireEvent.press(screen.getByTestId("report-submit"));
    expect(router.dismissAll).not.toHaveBeenCalled();
  });
});

describe("MemberSafetySheet", () => {
  it("offers a DM, a report and a block for someone else in the group", async () => {
    const onMessage = jest.fn();
    const onClose = jest.fn();
    await render(<MemberSafetySheet wsId="w1" person={person} onClose={onClose} onMessage={onMessage} />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.safety.message") }));
    expect(onMessage).toHaveBeenCalledWith(person);
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.block_user") }));
    await confirmAlert();
    expect(safetyApi.block).toHaveBeenCalledWith("w1", "u2");
    // Blocking a group member keeps the reader in the group.
    expect(router.dismissAll).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.report.action_user", { name: "Bình" }) }));
    expect(screen.getByRole("header", { name: viText("mobile.report.title_user", { name: "Bình" }) })).toBeOnTheScreen();
    expect(screen.getByLabelText(viText("mobile.report.also_block", { name: "Bình" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole("button", { name: viText("common.cancel") }).at(-1)!);
  });

  it("offers no DM when either side blocked, and unblocks", async () => {
    status.mockResolvedValue({ blocked_by_me: true, blocked_me: false });
    await render(<MemberSafetySheet wsId="w1" person={person} onClose={jest.fn()} onMessage={jest.fn()} />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.unblock_user") }));
    expect(screen.queryByRole("button", { name: viText("mobile.safety.message") })).toBeNull();
    expect(safetyApi.unblock).toHaveBeenCalledWith("w1", "u2");
  });

  it("shows nothing without a person", async () => {
    await render(<MemberSafetySheet wsId="w1" person={null} onClose={jest.fn()} onMessage={jest.fn()} />);
    expect(screen.queryByRole("button", { name: viText("mobile.safety.message") })).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });
});

describe("DmBlockBanner", () => {
  it("says nothing until someone blocked, then which side", async () => {
    const view = await render(<DmBlockBanner wsId="w1" peerUserId="u2" />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();

    status.mockResolvedValue({ blocked_by_me: true, blocked_me: false });
    await view.rerender(<DmBlockBanner wsId="w1" peerUserId="u3" />);
    expect(await screen.findByText(viText("chat.block_active_banner"))).toBeOnTheScreen();

    status.mockResolvedValue({ blocked_by_me: false, blocked_me: true });
    await view.rerender(<DmBlockBanner wsId="w1" peerUserId="u4" />);
    expect(await screen.findByText(viText("chat.blocked_me_banner"))).toBeOnTheScreen();
  });
});
