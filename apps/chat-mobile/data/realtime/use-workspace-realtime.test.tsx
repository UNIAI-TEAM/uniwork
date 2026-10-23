// The workspace layout's realtime: the chat and call hooks join, and the
// workspace list refetches on a workspace.* frame and on every reconnect.
import { renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWorkspaceRealtime } from "./use-workspace-realtime";

const mockChat = jest.fn();
const mockCall = jest.fn();
jest.mock("./use-chat-realtime", () => ({ useChatRealtime: (wsId: string) => mockChat(wsId) }));
jest.mock("./use-call-realtime", () => ({ useCallRealtime: (wsId: string) => mockCall(wsId) }));

type AnyHandler = (message: { type: string }) => void;
const mockSocket = { any: [] as AnyHandler[], reconnect: [] as (() => void)[] };
const mockWs = {
  onAny: (handler: AnyHandler) => {
    mockSocket.any.push(handler);
    return () => undefined;
  },
  onReconnect: (handler: () => void) => {
    mockSocket.reconnect.push(handler);
    return () => undefined;
  },
};
jest.mock("./realtime-provider", () => ({ useWSClient: () => mockWs }));

it("joins the chat and call hooks and refetches the workspace list on workspace frames and reconnects", async () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  await renderHook(() => useWorkspaceRealtime("w1"), { wrapper });
  expect(mockChat).toHaveBeenCalledWith("w1");
  expect(mockCall).toHaveBeenCalledWith("w1");

  for (const handler of mockSocket.any) handler({ type: "chat.message.created" });
  expect(invalidate).not.toHaveBeenCalled();
  for (const handler of mockSocket.any) handler({ type: "workspace.updated" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
  for (const handler of mockSocket.reconnect) handler();
  expect(invalidate).toHaveBeenCalledTimes(2);
});
