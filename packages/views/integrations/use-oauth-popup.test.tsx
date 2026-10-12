import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { useOAuthPopup, type OAuthPopupOutcome } from "./use-oauth-popup";

const API = "https://api.uniwork.test";
const TYPE = "uniwork:email-hub-oauth";
const AUTH_URL = "https://accounts.google.test/o/oauth2/v2/auth?state=s";

type FakePopup = { closed: boolean; close: () => void; focus: () => void; location: { href: string } };
type Start = () => Promise<string | null | undefined>;

function fakePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
    location: { href: "" },
  };
  return popup;
}

function post(source: unknown, data: unknown, origin = API) {
  const event = new MessageEvent("message", { data, origin });
  // jsdom only accepts a real Window as MessageEventInit.source, so the fake popup is attached by hand.
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

// null means "no messageType" (undefined would take the default).
function setup(messageType: string | null = TYPE) {
  const onOutcome = vi.fn<(outcome: OAuthPopupOutcome) => void>();
  const hook = renderHook(() =>
    useOAuthPopup({ name: "uniwork-test-oauth", messageType: messageType ?? undefined, onOutcome }),
  );
  return { onOutcome, hook };
}

async function openWith(hook: ReturnType<typeof setup>["hook"], start: Start) {
  await act(async () => {
    hook.result.current.open(start);
  });
}

function tick() {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

let popup: FakePopup;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  configureRuntime({ apiUrl: API });
  popup = fakePopup();
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetRuntimeConfig();
});

describe("useOAuthPopup", () => {
  it("reports a blocked popup without starting or going pending", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    const { onOutcome, hook } = setup();
    const start = vi.fn<Start>();

    await openWith(hook, start);

    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "uniwork-test-oauth",
      "popup,width=560,height=720",
    );
    expect(start).not.toHaveBeenCalled();
    expect(onOutcome.mock.calls).toEqual([[{ kind: "blocked" }]]);
    expect(hook.result.current.pending).toBe(false);
  });

  it.each([
    ["start rejects", () => Promise.reject(new Error("boom"))],
    ["start returns no URL", () => Promise.resolve("")],
  ])("closes the popup and reports failed when %s", async (_, start: Start) => {
    const { onOutcome, hook } = setup();

    await openWith(hook, start);

    expect(popup.close).toHaveBeenCalled();
    expect(onOutcome.mock.calls).toEqual([[{ kind: "failed" }]]);
    expect(hook.result.current.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores foreign messages, then reports the popup's message once", async () => {
    const { onOutcome, hook } = setup();

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    expect(popup.location.href).toBe(AUTH_URL);
    expect(hook.result.current.pending).toBe(true);

    post(popup, { type: TYPE, ok: true, code: "connected" }, "https://evil.test");
    post(popup, { type: "uniwork:other", ok: true, code: "connected" });
    post({}, { type: TYPE, ok: true, code: "connected" });
    post(popup, { type: TYPE, ok: true, code: 1 });
    post(popup, "connected");
    expect(onOutcome).not.toHaveBeenCalled();

    post(popup, { type: TYPE, ok: "yes", code: "already_connected" });
    expect(onOutcome.mock.calls).toEqual([
      [{ kind: "message", ok: false, code: "already_connected" }],
    ]);
    expect(hook.result.current.pending).toBe(false);

    popup.closed = true;
    tick();
    post(popup, { type: TYPE, ok: true, code: "connected" });
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports closed when the popup closes without a message", async () => {
    const { onOutcome, hook } = setup(null);

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    // Without messageType no listener is attached: even a well-formed message is not an outcome.
    post(popup, { type: TYPE, ok: true, code: "connected" });
    tick();
    expect(onOutcome).not.toHaveBeenCalled();

    popup.closed = true;
    tick();
    tick();

    expect(onOutcome.mock.calls).toEqual([[{ kind: "closed" }]]);
    expect(hook.result.current.pending).toBe(false);
  });

  it("reports nothing after unmount and leaves no listener or interval", async () => {
    const { onOutcome, hook } = setup();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    hook.unmount();

    expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    post(popup, { type: TYPE, ok: true, code: "connected" });
    popup.closed = true;
    tick();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("closes a popup whose URL arrives after unmount", async () => {
    const { onOutcome, hook } = setup();
    let resolve: (url: string) => void = () => {};
    const start = () =>
      new Promise<string>((r) => {
        resolve = r;
      });

    await openWith(hook, start);
    hook.unmount();
    await act(async () => {
      resolve(AUTH_URL);
    });

    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("");
    expect(onOutcome).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("brings the open popup to the front, and does nothing once it has reported", async () => {
    const { hook } = setup();
    hook.result.current.focus();

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    hook.result.current.focus();
    expect(popup.focus).toHaveBeenCalledTimes(1);

    popup.closed = true;
    tick();
    hook.result.current.focus();
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });
});
