import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { memoryRecordingStore, type RecordingStore } from "@uniwork/core/meetings/recorder";
import type { User, Workspace } from "@uniwork/core/types";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { AccountMenu } from "./account-menu";
import { WorkspaceProvider } from "./workspace-context";

// Sign-out reads this device's recordings from the shared store; each test hands it a fresh one.
const device = vi.hoisted(() => ({ store: undefined as RecordingStore | undefined }));
vi.mock("@uniwork/core/meetings/recorder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/meetings/recorder")>()),
  readUnsentRecordings: (userId: string) => device.store!.listParts(userId),
}));

initI18n();

const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };

function renderMenu() {
  const logout = vi.fn(async () => {});
  setSessionUser(user);
  useAuthStore.setState({ logout });
  const nav = fakeNav("/acme/team/meetings");
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AccountMenu placement="header" />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return { logout, nav };
}

async function signOut() {
  fireEvent.click(screen.getByRole("button", { name: /An/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Đăng xuất" }));
}

beforeEach(() => {
  device.store = memoryRecordingStore();
});
afterEach(() => resetAuthStoreForTests());

describe("AccountMenu", () => {
  it("warns before signing out with an unsent recording", async () => {
    await device.store!.createPart({
      id: "p1", userId: "u1", meetingId: "m1", startedAt: 1_000, lastChunkAt: 60_000, endedAt: 60_000,
      mimeType: "audio/webm", bytes: 10, language: "vi", offsetSeconds: 0,
    });
    const { logout, nav } = renderMenu();

    await signOut();
    const dialog = await screen.findByRole("alertdialog", { name: "Còn 1 bản ghi chưa gửi" });
    expect(dialog).toHaveTextContent("Bản ghi vẫn nằm trên máy này. Đăng nhập lại để gửi.");
    fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(logout).not.toHaveBeenCalled();

    await signOut();
    fireEvent.click(await screen.findByRole("button", { name: "Vẫn đăng xuất" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    // Signing out never takes the recording with it.
    expect(await device.store!.listParts("u1")).toHaveLength(1);
  });

  it("reads the device only when the person signs out", async () => {
    const read = vi.spyOn(device.store!, "listParts");
    const { logout } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /An/ }));
    await screen.findByRole("menuitem", { name: "Đăng xuất" });
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Đăng xuất" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(read).toHaveBeenCalledWith("u1");
  });

  it("signs out after 1.5 s when the device never answers", async () => {
    vi.spyOn(device.store!, "listParts").mockReturnValue(new Promise(() => {}));
    const { logout } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: /An/ }));
    const item = await screen.findByRole("menuitem", { name: "Đăng xuất" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.click(item);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(logout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(logout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("signs out when the device cannot be read", async () => {
    vi.spyOn(device.store!, "listParts").mockRejectedValue(new Error("blocked"));
    const { logout } = renderMenu();
    await signOut();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("signs out at once with nothing on the device", async () => {
    const { logout } = renderMenu();
    await signOut();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
