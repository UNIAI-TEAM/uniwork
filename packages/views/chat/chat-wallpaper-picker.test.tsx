import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatWallpaperPicker } from "./chat-wallpaper-picker";

initI18n();

const patchChatRoom = vi.fn().mockResolvedValue({});
vi.mock("@uniwork/core/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/chat")>();
  return {
    ...actual,
    useChatRooms: () => ({
      data: [{ id: "room-a", kind: "dm", name: "A", workspace_id: "ws1", wallpaper: { preset: "default" } }],
    }),
    useUpdateChatRoomWallpaper: () => ({
      isPending: false,
      mutateAsync: (input: { roomId: string; preset: string }) => {
        patchChatRoom(input);
        return Promise.resolve();
      },
    }),
    useUploadChatRoomWallpaper: () => ({ isPending: false, mutateAsync: vi.fn() }),
  };
});

beforeEach(() => {
  patchChatRoom.mockClear();
});

describe("ChatWallpaperPicker", () => {
  it("saves a preset to the server when the user can edit", async () => {
    render(<ChatWallpaperPicker workspaceId="ws1" roomId="room-a" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Trời xanh" }));
    await waitFor(() => {
      expect(patchChatRoom).toHaveBeenCalledWith({ roomId: "room-a", preset: "sky" });
    });
  });
});
