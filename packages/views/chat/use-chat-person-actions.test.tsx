import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { wrap } from "../test/api-mock";
import { useChatPersonActions } from "./use-chat-person-actions";

initI18n();

const resolveDm = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/chat", () => ({
  useResolveDMRoom: () => ({ mutateAsync: resolveDm }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";

const people = [{ user_id: "user-tra", display_name: "Trà My Đào", email: "dtramy28@gmail.com" }];

describe("useChatPersonActions", () => {
  const setTarget = vi.fn();
  const startCall = vi.fn<
    (roomId: string, label: string, callKind: "dm", options?: { withCamera?: boolean }) => Promise<boolean>
  >();
  const closeSheets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    startCall.mockResolvedValue(true);
  });

  function setup(contacts: readonly ChatContact[] = []) {
    return renderHook(
      () =>
        useChatPersonActions({
          workspaceId: "ws-1",
          currentUserId: "me",
          nameContext: people,
          contacts,
          setTarget,
          startCall,
          closeSheets,
        }),
      { wrapper: ({ children }) => wrap(<>{children}</>) },
    );
  }

  it("opens the direct conversation", () => {
    const { result } = setup();
    act(() => result.current.messagePerson("user-tra"));
    expect(setTarget).toHaveBeenCalledWith({
      kind: "dm",
      contact: { user_id: "user-tra", email: "dtramy28@gmail.com", display_name: "Trà My Đào" },
    });
    expect(closeSheets).toHaveBeenCalledTimes(1);
    expect(startCall).not.toHaveBeenCalled();
  });

  it("rings the room that already exists", async () => {
    const { result } = setup([
      { user_id: "user-tra", email: "dtramy28@gmail.com", display_name: "Trà My Đào", dm_room_id: "room-9" },
    ]);
    act(() => result.current.callPerson("user-tra"));
    await waitFor(() => expect(startCall).toHaveBeenCalledWith("room-9", "Trà My Đào", "dm"));
    expect(resolveDm).not.toHaveBeenCalled();
    expect(setTarget).toHaveBeenCalledWith({
      kind: "dm",
      contact: {
        user_id: "user-tra",
        email: "dtramy28@gmail.com",
        display_name: "Trà My Đào",
        dm_room_id: "room-9",
      },
    });
  });

  it("rings with the camera on", async () => {
    const { result } = setup([
      { user_id: "user-tra", email: "dtramy28@gmail.com", display_name: "Trà My Đào", dm_room_id: "room-9" },
    ]);
    act(() => result.current.callPerson("user-tra", { withCamera: true }));
    await waitFor(() =>
      expect(startCall).toHaveBeenCalledWith("room-9", "Trà My Đào", "dm", { withCamera: true }),
    );
  });

  it("resolves a room, then rings it", async () => {
    resolveDm.mockResolvedValue({ id: "room-new" });
    const { result } = setup();
    act(() => result.current.callPerson("user-tra"));
    await waitFor(() => expect(startCall).toHaveBeenCalledWith("room-new", "Trà My Đào", "dm"));
    expect(resolveDm).toHaveBeenCalledWith("user-tra");
  });

  it("does not call yourself", () => {
    const { result } = setup();
    act(() => result.current.callPerson("me"));
    expect(setTarget).not.toHaveBeenCalled();
    expect(startCall).not.toHaveBeenCalled();
  });

  it("says the call could not start when no room comes back", async () => {
    resolveDm.mockResolvedValue(null);
    const { result } = setup();
    act(() => result.current.callPerson("user-tra"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không bắt đầu được cuộc gọi. Thử lại."));
    expect(startCall).not.toHaveBeenCalled();
  });
});
