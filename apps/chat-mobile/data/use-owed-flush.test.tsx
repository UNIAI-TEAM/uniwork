// The outbox goes from any screen of the signed-in app: once the session is ready, on the network's
// offline → online edge and on every return to the front — not only inside an open workspace.
import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { useOwedFlush } from "./use-owed-flush";

const mockFlushOwed = jest.fn(async () => undefined);
jest.mock("./owed", () => ({ flushOwed: (...args: unknown[]) => mockFlushOwed(...(args as [])) }));

type NetListener = (state: { isConnected: boolean | null }) => void;
const mockNet: { listeners: NetListener[]; unsubscribe: jest.Mock } = { listeners: [], unsubscribe: jest.fn() };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: NetListener) => {
      mockNet.listeners.push(listener);
      return mockNet.unsubscribe;
    },
  },
}));

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

beforeEach(() => {
  mockFlushOwed.mockClear();
  mockNet.listeners = [];
  mockNet.unsubscribe.mockClear();
});

it("does nothing until the session and the queues are read", async () => {
  await renderHook(() => useOwedFlush(null), { wrapper });
  expect(mockFlushOwed).not.toHaveBeenCalled();
  expect(mockNet.listeners).toHaveLength(0);
});

it("flushes once ready, on the offline → online edge only, and on each return to the front", async () => {
  let onAppState: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onAppState = listener as (state: string) => void;
    return { remove };
  });
  jest.spyOn(onlineManager, "isOnline").mockReturnValue(true);
  const { unmount } = await renderHook(() => useOwedFlush("u1"), { wrapper });
  expect(mockFlushOwed).toHaveBeenCalledTimes(1);
  expect(mockFlushOwed).toHaveBeenLastCalledWith(queryClient, "u1");

  const net = mockNet.listeners[0]!;
  await act(async () => net({ isConnected: true }));
  expect(mockFlushOwed).toHaveBeenCalledTimes(1);
  await act(async () => net({ isConnected: false }));
  await act(async () => net({ isConnected: null }));
  await act(async () => net({ isConnected: true }));
  expect(mockFlushOwed).toHaveBeenCalledTimes(2);

  await act(async () => onAppState?.("background"));
  expect(mockFlushOwed).toHaveBeenCalledTimes(2);
  await act(async () => onAppState?.("active"));
  expect(mockFlushOwed).toHaveBeenCalledTimes(3);

  await unmount();
  expect(mockNet.unsubscribe).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
