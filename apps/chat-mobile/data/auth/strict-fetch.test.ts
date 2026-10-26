import { beforeEach, describe, expect, it, vi } from "vitest";

const expo = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("expo/fetch", () => expo);

import { RedirectRefusedError, strictFetch } from "./strict-fetch";

beforeEach(() => expo.fetch.mockReset());

describe("strictFetch", () => {
  // React Native's global fetch ignores the redirect mode; expo/fetch hands it to OkHttp and URLSession, so a 3xx
  // from the API host fails the request instead of carrying the bearer to wherever it points.
  it("always asks the native stack to refuse a redirect, whatever the caller passed", async () => {
    const response = new Response("{}", { status: 200 });
    expo.fetch.mockResolvedValueOnce(response);
    const init: RequestInit = { method: "POST", headers: { Authorization: "Bearer t" }, body: "{}", redirect: "follow" };
    await expect(strictFetch("https://api.test/api/v1/me", init)).resolves.toBe(response);
    expect(expo.fetch).toHaveBeenCalledWith("https://api.test/api/v1/me", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: "{}",
      redirect: "error",
      credentials: "omit",
    });
  });

  it("names a refused redirect, so it is reported as the fault it is, not taken for a dead network", async () => {
    expo.fetch.mockRejectedValueOnce(new Error("fetch failed: Redirect is not allowed when redirect mode is 'error'"));
    const error = await strictFetch("https://api.test/x", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedirectRefusedError);
    expect(error).toMatchObject({ name: "RedirectRefusedError" });
  });

  it("turns a failure without a reply into React Native's own network TypeError, keeping the cause", async () => {
    const cause = new Error("fetch failed: Unable to resolve host");
    expo.fetch.mockRejectedValueOnce(cause);
    const error = await strictFetch("https://api.test/x", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ message: "fetch failed: Unable to resolve host", cause });
    expo.fetch.mockRejectedValueOnce("socket closed");
    expect(await strictFetch("https://api.test/x", {}).catch((e: unknown) => e)).toMatchObject({ name: "TypeError", message: "socket closed" });
  });

  it("turns a cancelled request into an AbortError, which nobody reports", async () => {
    const controller = new AbortController();
    controller.abort();
    expo.fetch.mockRejectedValueOnce(new Error("fetch failed: The operation was aborted."));
    const error = await strictFetch("https://api.test/x", { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
