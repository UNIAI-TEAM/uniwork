// A task's drain (task-env.ts) boots what no screen did — the runtime, the encrypted store, the kept server switches,
// the session, the person's queues — and asks NetInfo again before it sends; it delivers through owed.ts with the
// running app's switches.
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  bootRuntime: vi.fn(),
  session: { status: vi.fn(() => "signed-in"), restore: vi.fn(async () => true) },
  readLastUser: vi.fn(async () => ({ id: "me" }) as { id: string } | null),
  storeInstalled: true,
  installDeviceStore: vi.fn(),
  restoreRemoteConfig: vi.fn(async () => true),
  flags: { unichat_mobile_outbox_flush: true, unichat_mobile_background_send: true } as Record<string, boolean>,
  hydrated: true,
  hydrateChatSendStore: vi.fn(async () => undefined),
  hydratePendingOpsStore: vi.fn(async () => undefined),
  deliverOwed: vi.fn(async () => undefined),
  owesServer: vi.fn(() => true),
  netRefresh: vi.fn(async () => ({ isConnected: true, isInternetReachable: true }) as { isConnected: boolean | null; isInternetReachable: boolean | null }),
  setOnline: vi.fn(),
}));
vi.mock("../boot", () => ({ bootRuntime: deps.bootRuntime }));
vi.mock("../auth/flow", () => ({ session: deps.session }));
vi.mock("../auth/last-user", () => ({ readLastUser: deps.readLastUser }));
vi.mock("../query-client", () => ({ queryClient: { tag: "qc" } }));
vi.mock("../remote-config", () => ({
  readMobileFlag: (_qc: unknown, name: string) => deps.flags[name],
  restoreRemoteConfig: deps.restoreRemoteConfig,
}));
vi.mock("../storage/device-store", () => ({
  deviceStoreInstalled: () => deps.storeInstalled,
  installDeviceStore: deps.installDeviceStore,
  openDeviceStore: "device-opener",
}));
vi.mock("../storage/native-device-store", () => ({ openNativeDeviceStore: "native-opener" }));
vi.mock("../stores/chat-send-store", () => ({
  hydrateChatSendStore: deps.hydrateChatSendStore,
  useChatSendStore: { persist: { hasHydrated: () => deps.hydrated } },
}));
vi.mock("../stores/pending-ops-store", () => ({
  hydratePendingOpsStore: deps.hydratePendingOpsStore,
  usePendingOpsStore: { persist: { hasHydrated: () => deps.hydrated } },
}));
vi.mock("../owed", () => ({ deliverOwed: deps.deliverOwed, owesServer: deps.owesServer }));
vi.mock("@react-native-community/netinfo", () => ({ default: { refresh: deps.netRefresh } }));
vi.mock("@tanstack/react-query", () => ({ onlineManager: { setOnline: deps.setOnline } }));

import { installReportSink } from "../report";
import { DRAIN_BUDGET_MS } from "./drain";
import { taskDrainEnv } from "./task-env";

const breadcrumbs: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  breadcrumbs.length = 0;
  installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
  Object.assign(deps, { storeInstalled: true, hydrated: true });
  deps.flags = { unichat_mobile_outbox_flush: true, unichat_mobile_background_send: true };
  deps.session.status.mockReturnValue("signed-in");
  deps.readLastUser.mockResolvedValue({ id: "me" });
});

describe("a task's drain", () => {
  it("in the running app: the stored person, nothing installed or read twice, NetInfo asked again", async () => {
    await expect(taskDrainEnv.prepare()).resolves.toBe("me");
    expect(deps.bootRuntime).toHaveBeenCalled();
    expect(deps.installDeviceStore).not.toHaveBeenCalled();
    expect(deps.session.restore).not.toHaveBeenCalled();
    expect(deps.hydrateChatSendStore).not.toHaveBeenCalled();
    expect(deps.restoreRemoteConfig).toHaveBeenCalledWith({ tag: "qc" }, "device-opener");
    expect(deps.setOnline).toHaveBeenCalledWith(true);
  });

  it("headless: opens the store, restores the session and reads the queues before anything is sent", async () => {
    Object.assign(deps, { storeInstalled: false, hydrated: false });
    deps.session.status.mockReturnValue("signed-out");
    deps.netRefresh.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    await expect(taskDrainEnv.prepare()).resolves.toBe("me");
    expect(deps.installDeviceStore).toHaveBeenCalledWith("native-opener");
    expect(deps.session.restore).toHaveBeenCalled();
    expect(deps.hydrateChatSendStore).toHaveBeenCalled();
    expect(deps.hydratePendingOpsStore).toHaveBeenCalled();
    expect(deps.setOnline).toHaveBeenCalledWith(false);
  });

  it("is nobody's when the session does not come back or no person is stored", async () => {
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    await expect(taskDrainEnv.prepare()).resolves.toBeNull();
    deps.session.status.mockReturnValue("signed-in");
    deps.readLastUser.mockResolvedValueOnce(null);
    await expect(taskDrainEnv.prepare()).resolves.toBeNull();
    expect(deps.hydrateChatSendStore).not.toHaveBeenCalled();
  });

  it("goes on with the switches' defaults when the kept server answer cannot be read", async () => {
    deps.restoreRemoteConfig.mockRejectedValueOnce(new Error("store"));
    await expect(taskDrainEnv.prepare()).resolves.toBe("me");
    expect(breadcrumbs).toContain("kept answer not read");
  });

  it("delivers through owed.ts within the long budget, under the same switches", async () => {
    await taskDrainEnv.deliver("me");
    expect(deps.deliverOwed).toHaveBeenCalledWith({ tag: "qc" }, "me");
    expect(taskDrainEnv.owes("me")).toBe(true);
    expect(deps.owesServer).toHaveBeenCalledWith("me");
    expect(taskDrainEnv.budgetMs).toBe(DRAIN_BUDGET_MS);
    expect(taskDrainEnv.enabled()).toBe(true);
  });
});
