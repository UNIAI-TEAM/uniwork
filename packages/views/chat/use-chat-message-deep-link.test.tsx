import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { useChatMessageDeepLink } from "./use-chat-message-deep-link";

function nav(query: string): NavigationAdapter {
  return {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname: "/acme/team/chat", searchParams: new URLSearchParams(query), getShareableUrl: (p) => p,
  };
}

function setup(adapter: NavigationAdapter, props: { activeRoomId: string | null; roomsReady: boolean }) {
  const onJump = vi.fn();
  // The URL moves by swapping the adapter, the way the host hands a new one down.
  const url = { current: adapter };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NavigationProvider value={url.current}>{children}</NavigationProvider>
  );
  const hook = renderHook((p: typeof props) => useChatMessageDeepLink({ ...p, onJump }), { wrapper, initialProps: props });
  return { onJump, hook, url };
}

describe("useChatMessageDeepLink", () => {
  it("waits for the named room, jumps to the message once, and drops the param", () => {
    const adapter = nav("room=r1&message=m1");
    const { onJump, hook } = setup(adapter, { activeRoomId: null, roomsReady: false });
    expect(onJump).not.toHaveBeenCalled();
    hook.rerender({ activeRoomId: "r1", roomsReady: true });
    expect(onJump).toHaveBeenCalledWith("m1");
    expect(adapter.replace).toHaveBeenCalledWith("/acme/team/chat?room=r1");
    hook.rerender({ activeRoomId: "r1", roomsReady: true });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("drops the message without jumping when another room opened instead", () => {
    const adapter = nav("room=r1&message=m1");
    const { onJump, hook, url } = setup(adapter, { activeRoomId: "r0", roomsReady: true });
    expect(onJump).not.toHaveBeenCalled();
    // The room sync gave up on r1 and wrote the fallback room into the URL.
    url.current = { ...adapter, searchParams: new URLSearchParams("room=r0&message=m1") };
    hook.rerender({ activeRoomId: "r0", roomsReady: true });
    expect(onJump).not.toHaveBeenCalled();
    expect(adapter.replace).toHaveBeenCalledWith("/acme/team/chat?room=r0");
  });
});
