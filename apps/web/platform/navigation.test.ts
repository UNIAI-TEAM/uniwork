import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLeaveGuard } from "@uniwork/views/navigation";
import { createWebNavigationAdapter } from "./web-navigation-adapter";

const PATH = "/acme/doi/documents/d1";

function fakeRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
}

const unregister: Array<() => void> = [];
function guardWith(answer: (path: string) => Promise<boolean>) {
  unregister.push(registerLeaveGuard(answer));
}

function flushed() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const off of unregister.splice(0)) off();
  vi.clearAllMocks();
});

describe("web navigation adapter leave guards", () => {
  it("refuses back() while a leave guard rejects: the router does not move", async () => {
    const router = fakeRouter();
    const adapter = createWebNavigationAdapter(router, PATH, new URLSearchParams());
    guardWith(() => Promise.resolve(false));

    adapter.back();
    await flushed();

    expect(router.back).not.toHaveBeenCalled();
  });

  it("lets back() through once the guard allows", async () => {
    const router = fakeRouter();
    const adapter = createWebNavigationAdapter(router, PATH, new URLSearchParams());
    guardWith(() => Promise.resolve(true));

    adapter.back();
    await vi.waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  });

  it("asks the guard for push and forward with the current path too", async () => {
    const router = fakeRouter();
    const adapter = createWebNavigationAdapter(router, PATH, new URLSearchParams());
    const asked: string[] = [];
    guardWith((path) => {
      asked.push(path);
      return Promise.resolve(false);
    });

    adapter.push("/acme/doi/documents");
    adapter.forward?.();
    await flushed();

    expect(asked).toEqual([PATH, PATH]);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.forward).not.toHaveBeenCalled();
  });
});

describe("web navigation adapter openExternal", () => {
  it("hard-navigates the same window to the URL, without asking the leave guards", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    const guard = vi.fn(() => Promise.resolve(false));
    guardWith(guard);
    createWebNavigationAdapter(fakeRouter(), PATH, new URLSearchParams()).openExternal?.("https://pay.example/c/1");
    vi.unstubAllGlobals();
    expect(assign).toHaveBeenCalledWith("https://pay.example/c/1");
    expect(guard).not.toHaveBeenCalled();
  });
});
