import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  restore: vi.fn(async () => undefined),
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => null),
  login: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  status: vi.fn(() => "signed-out"),
}));
vi.mock("./flow", () => ({ session: sessionMock }));

const workspaceClear = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../stores/workspace-store", () => ({ useWorkspaceStore: { getState: () => ({ clear: workspaceClear }) } }));

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
vi.mock("../local-wipe", () => ({ wipeDeviceTraces }));

import { ApiError } from "../api";
import { installReportSink } from "../report";
import { useChatSendStore } from "../stores/chat-send-store";
import { PUSH_UNREGISTER_BUDGET_MS, useAuthStore } from "./store";

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
  it("initialize: no stored session -> loading ends without /me", async () => {
    sessionMock.getAccessToken.mockResolvedValue(null);
    await useAuthStore.getState().initialize();
    expect(sessionMock.restore).toHaveBeenCalledTimes(1);
    expect(apiMock.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
  });

  it("initialize: a restored session loads /me", async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user, isLoading: false });
  });

  it("initialize: a 401 ends the session only once the session itself is signed out; a blip keeps it", async () => {
    sessionMock.status.mockReturnValue("signed-out");
    apiMock.getMe.mockRejectedValueOnce(new ApiError("unauthorized", 401));
    await useAuthStore.getState().initialize();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });

    sessionMock.status.mockReturnValue("signed-in");
    apiMock.getMe.mockRejectedValueOnce(new TypeError("fetch failed"));
    await useAuthStore.getState().initialize();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
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
  });

  it("login: runs the browser sign-in and loads /me when it ends signed in", async () => {
    await useAuthStore.getState().login();
    expect(sessionMock.login).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it("login: a dismissed browser leaves the store signed out without /me", async () => {
    sessionMock.status.mockReturnValue("signed-out");
    await useAuthStore.getState().login();
    expect(apiMock.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("logout clears the user and the workspace, and hands the rest to the session; setUser overwrites", async () => {
    useAuthStore.getState().setUser(user);
    expect(useAuthStore.getState().user).toEqual(user);
    await useAuthStore.getState().logout();
    expect(sessionMock.logout).toHaveBeenCalledTimes(1);
    expect(workspaceClear).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("logout drops the cached rooms and messages and the unsent queue, so the next account on this phone sees none of them", async () => {
    useChatSendStore.setState({ entries: [{ clientMsgId: "c1" } as never] });
    useAuthStore.getState().setUser(user);
    await useAuthStore.getState().logout();
    expect(clearAccountCache).toHaveBeenCalledExactlyOnceWith(queryClientMock);
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
    expect(clearAccountCache).toHaveBeenCalledExactlyOnceWith(queryClientMock);
    expect(useChatSendStore.getState().entries).toEqual([]);
    expect(wipeDeviceTraces).toHaveBeenCalledExactlyOnceWith(["w1", "w2"]);
    expect(order).toEqual(["session", "wipe"]);
  });

  it("accountDeleted with no workspace list cached still wipes the device", async () => {
    await useAuthStore.getState().accountDeleted();
    expect(wipeDeviceTraces).toHaveBeenCalledExactlyOnceWith([]);
  });
});
