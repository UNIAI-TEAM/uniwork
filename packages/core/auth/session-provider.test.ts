import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, setAccessToken } from "../api/session";
import { getSessionProvider, registerSessionProvider, type SessionProvider } from "./session-provider";

function fakeProvider() {
  let listener: ((token: string | null) => void) | null = null;
  const off = vi.fn(() => {
    listener = null;
  });
  const provider: SessionProvider = {
    login: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => "t"),
    refresh: vi.fn(async () => "t"),
    logout: vi.fn(async () => {}),
    onChange: vi.fn((cb) => {
      listener = cb;
      return off;
    }),
  };
  return { provider, off, emit: (t: string | null) => listener?.(t) };
}

afterEach(() => {
  registerSessionProvider(null);
  setAccessToken(null);
});

describe("registerSessionProvider", () => {
  it("is null by default", () => {
    expect(getSessionProvider()).toBeNull();
  });

  it("subscribes once and mirrors the host token into the session", () => {
    const { provider, emit } = fakeProvider();
    registerSessionProvider(provider);
    expect(getSessionProvider()).toBe(provider);
    expect(provider.onChange).toHaveBeenCalledTimes(1);
    emit("tok-host");
    expect(getAccessToken()).toBe("tok-host");
    emit(null);
    expect(getAccessToken()).toBeNull();
  });

  it("unsubscribes when replaced or cleared", () => {
    const first = fakeProvider();
    const second = fakeProvider();
    registerSessionProvider(first.provider);
    registerSessionProvider(second.provider);
    expect(first.off).toHaveBeenCalledTimes(1);
    first.emit("stale");
    expect(getAccessToken()).toBeNull();
    registerSessionProvider(null);
    expect(second.off).toHaveBeenCalledTimes(1);
    expect(getSessionProvider()).toBeNull();
  });
});
