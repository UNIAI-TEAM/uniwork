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

const queryClear = vi.hoisted(() => vi.fn());
vi.mock("../query-client", () => ({ queryClient: { clear: queryClear } }));

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

import { ApiError } from "../api";
import { useChatSendStore } from "../stores/chat-send-store";
import { useAuthStore } from "./store";

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
    expect(queryClear).toHaveBeenCalledTimes(1);
    expect(useChatSendStore.getState().entries).toEqual([]);
  });
});
