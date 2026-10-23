// "Chuyển tiếp" (forward-sheet.tsx): every room of the workspace as a target in
// a recycling list, a search that narrows it, and a pick that forwards the
// message there once the sheet has closed.
import { QueryClient } from "@tanstack/react-query";
import { ChatRoomSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { api } from "@/data/api";
import { chatKeys } from "@/data/queries/chat-keys";
import { render, viText } from "@/test/render";
import { ForwardSheet } from "./forward-sheet";

const chat = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const room = (id: string, name: string) => ChatRoomSchema.parse({ id, workspace_id: "w1", name, kind: "group", member_count: 3 });

function client(rooms: ReturnType<typeof room>[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  queryClient.setQueryData(chatKeys.rooms("w1"), rooms);
  queryClient.setQueryData(chatKeys.nicknames("w1"), {});
  return queryClient;
}

beforeEach(() => jest.replaceProperty(Platform, "OS", "android"));
afterEach(() => jest.restoreAllMocks());

describe("ForwardSheet", () => {
  it("narrows the rooms by the search, and forwards to the one picked", async () => {
    const request = jest.spyOn(api, "request").mockResolvedValue({ forwarded: 1 });
    const onClose = jest.fn();
    await render(<ForwardSheet chat={chat} messageId="m1" onClose={onClose} />, { queryClient: client([room("g1", "Thiết kế"), room("g2", "Sản phẩm")]) });
    expect(screen.getByRole("header", { name: viText("chat.mobile.forward_pick_room") })).toBeOnTheScreen();
    await act(async () => fireEvent.changeText(screen.getByLabelText(viText("chat.search_conversations_label")), "san pham"));
    expect(screen.queryByRole("button", { name: "Thiết kế" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Sản phẩm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining("/messages/m1/forward"), expect.anything()));
  });

  it("says so in an alert when the forward fails, and forwards nothing without a message", async () => {
    jest.spyOn(api, "request").mockRejectedValue(new Error("offline"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await render(<ForwardSheet chat={chat} messageId="m1" onClose={jest.fn()} />, { queryClient: client([room("g1", "Thiết kế")]) });
    await fireEvent.press(screen.getByRole("button", { name: "Thiết kế" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(viText("common.error")));
    await view.rerender(<ForwardSheet chat={chat} messageId={null} onClose={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Thiết kế" })).toBeNull();
  });

  it("mounts a screenful of a few hundred rooms, not all of them", async () => {
    const many = Array.from({ length: 300 }, (_, n) => room(`g${n}`, `Nhóm ${n}`));
    await render(<ForwardSheet chat={chat} messageId="m1" onClose={jest.fn()} />, { queryClient: client(many) });
    expect(screen.getAllByText(/^Nhóm \d+$/).length).toBeLessThan(60);
  });
});
