import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  restore: vi.fn<(options?: { awaitRefresh?: boolean }) => Promise<boolean>>(async () => true),
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => null),
  login: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  discardStored: vi.fn(async () => undefined),
  status: vi.fn(() => "signed-out"),
}));
vi.mock("./flow", () => ({ session: sessionMock }));

const workspaceClear = vi.hoisted(() => vi.fn(async () => undefined));
const workspaceRestore = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => undefined));
vi.mock("../stores/workspace-store", () => ({ useWorkspaceStore: { getState: () => ({ clear: workspaceClear, restore: workspaceRestore }) } }));

const lastUserMock = vi.hoisted(() => ({
  readLastUser: vi.fn<() => Promise<unknown>>(async () => null),
  rememberUser: vi.fn(async () => undefined),
  forgetLastUser: vi.fn(async () => undefined),
}));
vi.mock("./last-user", () => lastUserMock);

const firstLaunchOfInstall = vi.hoisted(() => vi.fn<() => Promise<boolean>>(async () => false));
vi.mock("../install-marker", () => ({ firstLaunchOfInstall }));

const cacheMock = vi.hoisted(() => ({
  restoreAccountCache: vi.fn<(userId: string) => Promise<void>>(async () => undefined),
  dropAccountCache: vi.fn(async () => undefined),
}));
vi.mock("../query-persister", () => cacheMock);
// The outbox directory is native (outbox-files.test.ts covers it).
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));

const queryClientMock = vi.hoisted(() => ({ name: "the app's query client", getQueryData: vi.fn<(key: unknown) => unknown>(() => undefined) }));
vi.mock("../query-client", () => ({ queryClient: queryClientMock }));
const clearAccountCache = vi.hoisted(() => vi.fn());
vi.mock("../remote-config", () => ({ clearAccountCache }));

const apiMock = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("../api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: apiMock, ApiError };
});

const pushMock = vi.hoisted(() => ({
  unregisterPushToken: vi.fn<(api: unknown) => Promise<void>>(async () => undefined),
  forgetPushToken: vi.fn(),
}));
vi.mock("../push", () => pushMock);

const wipeDeviceTraces = vi.hoisted(() => vi.fn<(ids: readonly string[]) => Promise<void>>(async () => undefined));
const wipeSessionTraces = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => undefined));
vi.mock("../local-wipe", () => ({ wipeDeviceTraces, wipeSessionTraces }));

import { ApiError } from "../api";
import { installReportSink } from "../report";
import { useChatSendStore } from "../stores/chat-send-store";
import { useDraftStore } from "../stores/draft-store";
import { usePendingOpsStore } from "../stores/pending-ops-store";
import { PUSH_UNREGISTER_BUDGET_MS, useAuthStore } from "./store";
import { openDeviceStore } from "../storage/device-store";

const user = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "en",
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isLoading: true });
  sessionMock.getAccessToken.mockResolvedValue("at_1");
  sessionMock.status.mockReturnValue("signed-in");
  apiMock.getMe.mockResolvedValue(user);
});

describe("auth store", () => {
  // Audit (Security & privacy, keychain-survives-reinstall).
  it("initialize on the first launch of a new install discards the previous install's session and person before reading them", async () => {
    const order: string[] = [];
    firstLaunchOfInstall.mockResolvedValueOnce(true);
    sessionMock.discardStored.mockImplementationOnce(async () => {
      order.push("discard");
    });
    lastUserMock.forgetLastUser.mockImplementationOnce(async () => {
      order.push("forget");
    });
    sessionMock.restore.mockImplementationOnce(async () => {
      order.push("restore");
      return false;
    });
    await useAuthStore.getState().initialize();
    expect(order).toEqual(["discard", "forget", "restore"]);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });

    // Any later launch resumes what it finds.
    await useAuthStore.getState().initialize();
    expect(sessionMock.discardStored).toHaveBeenCalledTimes(1);
  });

  it("initialize: no stored session -> loading ends without /me, and a stored person from before is forgotten", async () => {
    sessionMock.restore.mockResolvedValueOnce(false);
    lastUserMock.readLastUser.mockResolvedValueOnce(user);
    await useAuthStore.getState().initialize();
    expect(sessionMock.restore).toHaveBeenCalledExactlyOnceWith({ awaitRefresh: false });
    expect(apiMock.getMe).not.toHaveBeenCalled();
    expect(lastUserMock.forgetLastUser).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });

    sessionMock.restore.mockResolvedValueOnce(false);
    await useAuthStore.getState().initialize();
    expect(lastUserMock.forgetLastUser).toHaveBeenCalledTimes(1);
  });

  it("initialize: a session the server ended while the rest was read opens nothing, stored person or not", async () => {
    lastUserMock.readLastUser.mockResolvedValueOnce(user);
    sessionMock.status.mockReturnValue("signed-out");
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
    expect(lastUserMock.forgetLastUser).toHaveBeenCalledTimes(1);
    expect(apiMock.getMe).not.toHaveBeenCalled();
  });

  // Review P2: refresh_expired or device_revoked before anyone was let in left the last person's
  // unsent messages, queued reactions and cached rooms for the next account to see, retry and post as itself.
  it("initialize: a session the server ended before anyone was let in wipes what the last person left, as a sign-out does", async () => {
    lastUserMock.readLastUser.mockResolvedValueOnce(user);
    sessionMock.status.mockReturnValue("signed-out");
    useChatSendStore.setState({ entries: [{ clientMsgId: "c1", workspaceId: "w1", roomId: "r1", senderId: "u1", body: "hi", createdAt: 1, status: "queued" }] });
    usePendingOpsStore.setState({ ops: [{ kind: "read", key: "read/w1/r1", workspaceId: "w1", roomId: "r1", userId: "u1", createdAt: 1, rev: 1, verify: false }] });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
    expect(useChatSendStore.getState().entries).toEqual([]);
    expect(usePendingOpsStore.getState().ops).toEqual([]);
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(1);
    expect(workspaceClear).toHaveBeenCalledTimes(1);
    expect(lastUserMock.forgetLastUser).toHaveBeenCalledTimes(1);
    expect(clearAccountCache).toHaveBeenCalledExactlyOnceWith(queryClientMock, openDeviceStore);
    expect(wipeSessionTraces).toHaveBeenCalledTimes(1);
    expect(sessionMock.logout).not.toHaveBeenCalled();

    // No stored person (the first start of this build) but a queue: it goes too.
    sessionMock.restore.mockResolvedValueOnce(false);
    useChatSendStore.setState({ entries: [{ clientMsgId: "c2", workspaceId: "w1", roomId: "r1", senderId: "u1", body: "hi", createdAt: 1, status: "failed" }] });
    await useAuthStore.getState().initialize();
    expect(useChatSendStore.getState().entries).toEqual([]);
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(2);

    // A draft left in a room is the last person's too: it goes, with the rest.
    sessionMock.restore.mockResolvedValueOnce(false);
    useDraftStore.getState().setText("u1/w1/r1/", "chưa gửi");
    await useAuthStore.getState().initialize();
    expect(useDraftStore.getState().drafts).toEqual({});
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(3);

    // Nothing of anyone left: nothing to wipe.
    sessionMock.restore.mockResolvedValueOnce(false);
    await useAuthStore.getState().initialize();
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(3);
  });

  it("initialize: a first start whose /me finds the session ended wipes the queue left behind", async () => {
    sessionMock.status.mockReturnValueOnce("signed-in").mockReturnValue("signed-out");
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unauthorized", 401));
    usePendingOpsStore.setState({ ops: [{ kind: "read", key: "read/w1/r1", workspaceId: "w1", roomId: "r1", userId: "u1", createdAt: 1, rev: 1, verify: false }] });
    await useAuthStore.getState().initialize();
    expect(usePendingOpsStore.getState().ops).toEqual([]);
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(1);

    // Signed out with nothing left: nothing to wipe.
    sessionMock.status.mockReturnValueOnce("signed-in").mockReturnValue("signed-out");
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unauthorized", 401));
    await useAuthStore.getState().initialize();
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(1);
  });

  it("initialize reads the session, the stored person, the workspace and the unsent messages together", async () => {
    const started: string[] = [];
    const hold = (name: string) => async () => {
      started.push(name);
      await new Promise((resolve) => setTimeout(resolve, 0));
      started.push(`end:${name}`);
    };
    sessionMock.restore.mockImplementationOnce(async () => {
      await hold("session")();
      return false;
    });
    lastUserMock.readLastUser.mockImplementationOnce(async () => {
      await hold("user")();
      return null;
    });
    workspaceRestore.mockImplementationOnce(hold("workspace"));
    await useAuthStore.getState().initialize();
    // All three start before any of them ends.
    expect(started.slice(0, 3)).toEqual(["session", "user", "workspace"]);
  });

  it("initialize: a restored session without a stored person loads /me, remembers it and restores its cached rooms", async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user, isLoading: false });
    expect(lastUserMock.rememberUser).toHaveBeenCalledWith(user, expect.any(Number));
    expect(cacheMock.restoreAccountCache).toHaveBeenCalledExactlyOnceWith("u1");
  });

  it("initialize offline or on a 5xx (audit P0-3): the stored person opens the app at once and keeps it", async () => {
    const stored = { ...user, display_name: "Stored" };
    lastUserMock.readLastUser.mockResolvedValue(stored);
    // Offline: /me has not answered (it times out later); the app does not wait for it.
    let timeOut: (error: unknown) => void = () => undefined;
    apiMock.getMe.mockReturnValueOnce(new Promise((_, reject) => (timeOut = reject)));
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: stored, isLoading: false });
    expect(cacheMock.restoreAccountCache).toHaveBeenCalledWith("u1");
    timeOut(new ApiError("timeout", 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAuthStore.getState().user).toEqual(stored);

    // A 5xx behind the inbox keeps the stored person and the session.
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unavailable", 503));
    await useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(apiMock.getMe).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAuthStore.getState().user).toEqual(stored);
    expect(sessionMock.logout).not.toHaveBeenCalled();

    // A good answer replaces the stored profile.
    await useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(useAuthStore.getState().user).toEqual(user));

    // An answer about someone else (the person signed out and another came in meanwhile) is not adopted.
    let answer: (u: typeof user) => void = () => undefined;
    apiMock.getMe.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await useAuthStore.getState().initialize();
    useAuthStore.setState({ user: { ...user, id: "u2" } });
    answer(user);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAuthStore.getState().user?.id).toBe("u2");
    lastUserMock.readLastUser.mockResolvedValue(null);
  });

  it("initialize: a 401 ends the session only once the session itself is signed out; a blip keeps it", async () => {
    // Signed in while initialize reads the session; the 401's refresh then ends it.
    sessionMock.status.mockReturnValueOnce("signed-in").mockReturnValue("signed-out");
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unauthorized", 401));
    await useAuthStore.getState().initialize();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });

    sessionMock.status.mockReturnValue("signed-in");
    apiMock.getMe.mockRejectedValueOnce(new TypeError("fetch failed"));
    await useAuthStore.getState().initialize();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
    expect(cacheMock.restoreAccountCache).not.toHaveBeenCalled();
  });

  it("a /me that answers nothing usable remembers nobody", async () => {
    apiMock.getMe.mockResolvedValueOnce(null);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().user).toBeNull();
    expect(lastUserMock.rememberUser).not.toHaveBeenCalled();
  });

  it("initialize: a 401 while the session is only unreachable (refresh 5xx) keeps it for the next attempt", async () => {
    sessionMock.status.mockReturnValue("server-unreachable");
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unauthorized", 401));
    await useAuthStore.getState().initialize();
    expect(sessionMock.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
  });

  it("adoptSession: a session adopted outside login() (deep-link callback) loads /me without a restore", async () => {
    await useAuthStore.getState().adoptSession();
    expect(sessionMock.restore).not.toHaveBeenCalled();
    expect(apiMock.getMe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(user);

    // a token rotation re-emits: nothing to do with a user already loaded
    await useAuthStore.getState().adoptSession();
    expect(apiMock.getMe).toHaveBeenCalledTimes(1);
  });

  it("adoptSession during login() shares the one /me in flight", async () => {
    let resolveMe: (u: typeof user) => void = () => undefined;
    apiMock.getMe.mockReturnValueOnce(new Promise((resolve) => (resolveMe = resolve)));
    const login = useAuthStore.getState().login();
    const adopt = useAuthStore.getState().adoptSession();
    resolveMe(user);
    await Promise.all([login, adopt]);
    expect(apiMock.getMe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(user);
    // Review P1: one adoption, so one cache restore (two leaked a disk writer past sign-out).
    expect(cacheMock.restoreAccountCache).toHaveBeenCalledExactlyOnceWith("u1");
  });

  it("login: runs the browser sign-in and loads /me when it ends signed in, with that person's cached rooms", async () => {
    await useAuthStore.getState().login();
    expect(sessionMock.login).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(user);
    expect(cacheMock.restoreAccountCache).toHaveBeenCalledExactlyOnceWith("u1");

    // A /me that does not answer leaves nobody in and restores nothing.
    apiMock.getMe.mockRejectedValueOnce(new TypeError("fetch failed"));
    useAuthStore.setState({ user: null });
    await useAuthStore.getState().login();
    expect(useAuthStore.getState().user).toBeNull();
    expect(cacheMock.restoreAccountCache).toHaveBeenCalledTimes(1);
  });

  it("login: a dismissed browser leaves the store signed out without /me", async () => {
    sessionMock.status.mockReturnValue("signed-out");
    await useAuthStore.getState().login();
    expect(apiMock.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("logout clears the user, the workspace, the stored person and the cached rooms, and hands the rest to the session; setUser overwrites and remembers", async () => {
    useAuthStore.getState().setUser(user);
    expect(useAuthStore.getState().user).toEqual(user);
    expect(lastUserMock.rememberUser).toHaveBeenCalledWith(user, expect.any(Number));
    await useAuthStore.getState().logout();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(workspaceClear).toHaveBeenCalledTimes(1);
    expect(lastUserMock.forgetLastUser).toHaveBeenCalledTimes(1);
    expect(cacheMock.dropAccountCache).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("every sign-out, the person's or the server's, drops the cached photos, the tray and the badge after the session", async () => {
    const order: string[] = [];
    sessionMock.logout.mockImplementation(async () => {
      order.push("session");
    });
    wipeSessionTraces.mockImplementation(async () => {
      order.push("wipe");
    });
    await useAuthStore.getState().logout();
    expect(order).toEqual(["session", "wipe"]);
    // A revoked device or a reused refresh token ends in the same logout (app/_layout.tsx › onChange(null)).
    sessionMock.status.mockReturnValue("signed-out");
    await useAuthStore.getState().logout();
    expect(wipeSessionTraces).toHaveBeenCalledTimes(2);
    expect(wipeDeviceTraces).not.toHaveBeenCalled();
  });

  it("logout drops the cached rooms and messages and the unsent queue, so the next account on this phone sees none of them", async () => {
    useChatSendStore.setState({ entries: [{ clientMsgId: "c1" } as never] });
    useAuthStore.getState().setUser(user);
    await useAuthStore.getState().logout();
    expect(clearAccountCache).toHaveBeenCalledExactlyOnceWith(queryClientMock, openDeviceStore);
    expect(useChatSendStore.getState().entries).toEqual([]);
  });

  it("every sign-out drops the push subscription first, while the session can still authorize it", async () => {
    const order: string[] = [];
    pushMock.unregisterPushToken.mockImplementation(async () => {
      order.push("unsubscribe");
    });
    sessionMock.logout.mockImplementation(async () => {
      order.push("session");
    });
    await useAuthStore.getState().logout();
    expect(pushMock.unregisterPushToken).toHaveBeenCalledWith(apiMock);
    expect(order).toEqual(["unsubscribe", "session"]);
  });

  it("a sign-out the server made (session already over) forgets the token without a call it could not authorize", async () => {
    sessionMock.status.mockReturnValue("signed-out");
    await useAuthStore.getState().logout();
    expect(pushMock.forgetPushToken).toHaveBeenCalledTimes(1);
    expect(pushMock.unregisterPushToken).not.toHaveBeenCalled();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
  });

  it("a failed or hanging unsubscribe never holds the sign-out up past its budget", async () => {
    pushMock.unregisterPushToken.mockRejectedValueOnce(new Error("offline"));
    await useAuthStore.getState().logout();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      pushMock.unregisterPushToken.mockImplementationOnce(() => new Promise<void>(() => {}));
      const done = useAuthStore.getState().logout();
      await vi.advanceTimersByTimeAsync(PUSH_UNREGISTER_BUDGET_MS);
      await done;
      expect(sessionMock.logout).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the signed-in person to crash reporting by id only, and forgets them on sign-out", async () => {
    const setUser = vi.fn();
    installReportSink({ captureException: vi.fn(), addBreadcrumb: vi.fn(), setUser, setTag: vi.fn() });
    try {
      await useAuthStore.getState().initialize();
      await useAuthStore.getState().logout();
      expect(setUser.mock.calls).toEqual([["u1"], [null]]);
    } finally {
      installReportSink(null);
    }
  });

  it("accountDeleted ends the session without asking the server, then wipes what the account left on the phone", async () => {
    const order: string[] = [];
    sessionMock.logout.mockImplementation(async () => {
      order.push("session");
    });
    wipeDeviceTraces.mockImplementation(async () => {
      order.push("wipe");
    });
    queryClientMock.getQueryData.mockReturnValueOnce([{ id: "w1" }, { id: "w2" }]);
    useChatSendStore.setState({ entries: [{ clientMsgId: "c1" } as never] });
    useAuthStore.getState().setUser(user);

    await useAuthStore.getState().accountDeleted();

    expect(useAuthStore.getState().user).toBeNull();
    // The server already revoked every push subscription of the account.
    expect(pushMock.unregisterPushToken).not.toHaveBeenCalled();
    expect(pushMock.forgetPushToken).toHaveBeenCalledTimes(1);
    expect(workspaceClear).toHaveBeenCalledTimes(1);
    expect(clearAccountCache).toHaveBeenCalledExactlyOnceWith(queryClientMock, openDeviceStore);
    expect(useChatSendStore.getState().entries).toEqual([]);
    expect(wipeDeviceTraces).toHaveBeenCalledExactlyOnceWith(["w1", "w2"]);
    expect(order).toEqual(["session", "wipe"]);
  });

  it("accountDeleted with no workspace list cached still wipes the device", async () => {
    await useAuthStore.getState().accountDeleted();
    expect(wipeDeviceTraces).toHaveBeenCalledExactlyOnceWith([]);
  });
});
