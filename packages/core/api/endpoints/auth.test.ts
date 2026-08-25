import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getAccessToken, setAccessToken } from "../session";
import { completeOnboarding, login, logout, me, patchOnboarding, registerUser } from "./auth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const user = { id: "u1", email: "a@b.c", display_name: "A" };

describe("auth endpoints", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("login stores the access token on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-1" }));
    const sess = await login("a@b.c", "pw");
    expect(sess?.user.id).toBe("u1");
    expect(getAccessToken()).toBe("tok-1");
  });

  it("login returns null and leaves no token on a malformed response", async () => {
    // The one drift that cannot be smoothed over: without a token there is
    // no session, so the caller must see failure rather than half-auth.
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, token: "wrong-key" }));
    await expect(login("a@b.c", "pw")).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("registerUser posts display_name and stores the token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ user, access_token: "tok-2" }));
    await registerUser("a@b.c", "pw", "A");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.c", password: "pw", display_name: "A" });
    expect(getAccessToken()).toBe("tok-2");
  });

  it("logout clears the token even when the server call fails", async () => {
    setAccessToken("tok");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await logout();
    expect(getAccessToken()).toBeNull();
  });

  it("me / patchOnboarding / completeOnboarding return the user or null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ user }))
      .mockResolvedValueOnce(json({ user: { id: 1 } }))
      .mockResolvedValueOnce(json({ user }))
      .mockResolvedValueOnce(json({ nope: true }));
    expect((await me())?.id).toBe("u1");
    await expect(me()).resolves.toBeNull();
    expect((await patchOnboarding({ role: "pm" }))?.id).toBe("u1");
    await expect(completeOnboarding("workspace", "ws1")).resolves.toBeNull();
  });
});
