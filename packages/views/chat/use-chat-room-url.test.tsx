import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { useChatRoomUrl } from "./use-chat-room-url";

function makeNav(search = "") {
  return {
    push: vi.fn<(path: string) => void>(),
    replace: vi.fn<(path: string) => void>(),
    back: vi.fn<() => void>(),
    pathname: "/acme/team/chat",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p: string) => p,
  } satisfies NavigationAdapter;
}

type Props = { activeRoomId: string | null; wide: boolean; roomsReady: boolean };

function setup(nav: NavigationAdapter, initial: Props, resolveRoom = vi.fn(() => true)) {
  let current = nav;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NavigationProvider value={current}>{children}</NavigationProvider>
  );
  const hook = renderHook((props: Props) => useChatRoomUrl({ ...props, resolveRoom }), {
    initialProps: initial,
    wrapper,
  });
  return {
    ...hook,
    resolveRoom,
    /** The host's URL moved (our own write landing, or Back/Forward). */
    navigate(search: string, props: Props) {
      current = { ...current, searchParams: new URLSearchParams(search) };
      hook.rerender(props);
    },
  };
}

describe("useChatRoomUrl", () => {
  it("keeps a ?dm= deep link while its DM opens, and leaves the room it names alone", () => {
    const nav = makeNav("dm=U2");
    const resolveRoom = vi.fn(() => false);
    const h = setup(nav, { activeRoomId: "ws-room", wide: true, roomsReady: true }, resolveRoom);
    // The deep link opens a DM that has no room yet: the target moves off the
    // workspace room in the same render, then the DM's room resolves.
    act(() => {
      h.result.current.openRoom(null);
      h.rerender({ activeRoomId: null, wide: true, roomsReady: true });
    });
    h.rerender({ activeRoomId: "r-dm", wide: true, roomsReady: true });
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/chat?dm=U2&room=r-dm");

    // After a remount the empty DM is no known room; it must not be dropped.
    h.navigate("dm=U2&room=r-dm", { activeRoomId: null, wide: true, roomsReady: true });
    expect(resolveRoom).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalledWith("/acme/team/chat");
  });

  it("drops the ?dm= deep link once the reader picks another room", () => {
    const nav = makeNav("dm=U2&room=r-dm");
    const h = setup(nav, { activeRoomId: "r-dm", wide: true, roomsReady: true });
    h.result.current.openRoom("r-other");
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/chat?room=r-other");
  });


  it("on a phone, opening a room pushes history and Back returns to the list", () => {
    const nav = makeNav();
    const h = setup(nav, { activeRoomId: "ws-room", wide: false, roomsReady: true });
    expect(h.result.current.conversationOpen).toBe(false);

    h.result.current.openRoom("r1");
    expect(nav.push).toHaveBeenCalledWith("/acme/team/chat?room=r1");

    h.navigate("room=r1", { activeRoomId: "r1", wide: false, roomsReady: true });
    expect(h.result.current.conversationOpen).toBe(true);
    // Our own write is not a navigation to follow.
    expect(h.resolveRoom).not.toHaveBeenCalled();

    h.result.current.backToList();
    expect(nav.back).toHaveBeenCalled();
  });

  it("on a wide screen, switching rooms replaces the entry", () => {
    const nav = makeNav("room=r1");
    const h = setup(nav, { activeRoomId: "r1", wide: true, roomsReady: true });
    h.result.current.openRoom("r2");
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/chat?room=r2");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("restores the room named in the URL once rooms have loaded, and follows Back/Forward", () => {
    const nav = makeNav("room=r2");
    const h = setup(nav, { activeRoomId: null, wide: true, roomsReady: false }, vi.fn(() => false));
    expect(h.resolveRoom).toHaveBeenCalledWith("r2");
    expect(nav.replace).not.toHaveBeenCalled();

    h.resolveRoom.mockReturnValue(true);
    h.rerender({ activeRoomId: "ws-room", wide: true, roomsReady: true });
    expect(h.resolveRoom).toHaveBeenLastCalledWith("r2");

    h.navigate("room=r3", { activeRoomId: "r2", wide: true, roomsReady: true });
    expect(h.resolveRoom).toHaveBeenLastCalledWith("r3");
  });

  it("drops a room nobody knows from the URL", () => {
    const nav = makeNav("room=gone");
    setup(nav, { activeRoomId: "ws-room", wide: true, roomsReady: true }, vi.fn(() => false));
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/chat");
  });

  it("keeps the URL clean for the default room, and follows a room opened elsewhere (a new group)", () => {
    const nav = makeNav();
    const h = setup(nav, { activeRoomId: null, wide: true, roomsReady: false });
    h.rerender({ activeRoomId: "ws-room", wide: true, roomsReady: true });
    expect(nav.replace).not.toHaveBeenCalled();

    h.rerender({ activeRoomId: "new-group", wide: true, roomsReady: true });
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/chat?room=new-group");
  });

  it("opens a DM whose room does not exist yet, and writes the URL when it arrives", () => {
    const nav = makeNav();
    const h = setup(nav, { activeRoomId: "ws-room", wide: false, roomsReady: true });
    h.result.current.openRoom(null);
    h.rerender({ activeRoomId: null, wide: false, roomsReady: true });
    expect(h.result.current.conversationOpen).toBe(true);

    h.rerender({ activeRoomId: "dm-new", wide: false, roomsReady: true });
    expect(nav.push).toHaveBeenCalledWith("/acme/team/chat?room=dm-new");
  });
});
