// TanStack's online flag is the app's "online" (lib/reachability.ts): a captive portal or dead Wi-Fi pauses
// queries and holds the queues, and NetInfo probes UniChat's own /api/v1/healthz, configured before any listener.
import { focusManager, onlineManager } from "@tanstack/react-query";
import { AppState } from "react-native";
import { queryClient } from "./query-client";

type NetListener = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void;
interface NetMock {
  configured: unknown[];
  listeners: NetListener[];
  order: string[];
}
// Imports run before this file's constants: the mock keeps its own record, read back through requireMock.
jest.mock("@react-native-community/netinfo", () => {
  const state: NetMock = { configured: [], listeners: [], order: [] };
  return {
    __esModule: true,
    state,
    default: {
      configure: (config: unknown) => {
        state.order.push("configure");
        state.configured.push(config);
      },
      addEventListener: (listener: NetListener) => {
        state.order.push("listen");
        state.listeners.push(listener);
        return () => undefined;
      },
    },
  };
});
const mockNet = jest.requireMock<{ state: NetMock }>("@react-native-community/netinfo").state;
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: "https://api.unichat.example" } } } }));

// React Native's Jest preset records the AppState listener the focus bridge added at import (read before the
// per-test mock reset).
const onAppState = jest.mocked(AppState.addEventListener).mock.calls.filter(([type]) => type === "change").at(-1)?.[1];

it("probes /api/v1/healthz, counts a link that does not reach the internet as offline, and follows the app to the front", () => {
  expect(queryClient.getDefaultOptions().queries?.retry).toBe(1);
  expect(mockNet.configured).toEqual([expect.objectContaining({ reachabilityUrl: "https://api.unichat.example/api/v1/healthz", reachabilityMethod: "GET" })]);
  // configure() drops the listeners added before it.
  expect(mockNet.order[0]).toBe("configure");

  const net = mockNet.listeners.at(-1)!;
  net({ isConnected: true, isInternetReachable: false });
  expect(onlineManager.isOnline()).toBe(false);
  net({ isConnected: true, isInternetReachable: null });
  expect(onlineManager.isOnline()).toBe(true);
  net({ isConnected: false });
  expect(onlineManager.isOnline()).toBe(false);
  net({ isConnected: true, isInternetReachable: true });
  expect(onlineManager.isOnline()).toBe(true);

  onAppState?.("background");
  expect(focusManager.isFocused()).toBe(false);
  onAppState?.("active");
  expect(focusManager.isFocused()).toBe(true);
});
