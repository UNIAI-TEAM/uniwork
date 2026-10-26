import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLink, useNavigation } from "../navigation";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { RoomPanelNavigation } from "./room-panel-navigation";

function Pusher({ to }: { to: string }) {
  const nav = useNavigation();
  return (
    <button type="button" onClick={() => nav.push(to)}>
      {to}
    </button>
  );
}

describe("RoomPanelNavigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens another page in a new tab and keeps the room's own URL changes in place", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const nav = fakeNav("/o/w/meetings/m1/room");
    render(
      wrapWithNav(
        <RoomPanelNavigation>
          <AppLink href="/o/w/tasks/t1">Gửi báo giá</AppLink>
          <Pusher to="/o/w/meetings/m1/room?tab=chat" />
        </RoomPanelNavigation>,
        nav,
      ),
    );

    fireEvent.click(screen.getByRole("link", { name: "Gửi báo giá" }));
    expect(open).toHaveBeenCalledWith("/o/w/tasks/t1", "_blank", "noopener,noreferrer");
    expect(nav.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "/o/w/meetings/m1/room?tab=chat" }));
    expect(nav.push).toHaveBeenCalledWith("/o/w/meetings/m1/room?tab=chat");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
