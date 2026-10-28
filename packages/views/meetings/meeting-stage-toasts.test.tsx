import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventEmitter } from "events";
import type { ReactNode } from "react";
import { ConnectionState, RoomEvent } from "livekit-client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingStageToasts } from "./meeting-stage-toasts";

const lk = vi.hoisted(() => ({ room: null as unknown }));
const signals = vi.hoisted(() => ({ hands: [] as string[], localIdentity: "me" }));

vi.mock("@livekit/components-react", () => ({ useRoomContext: () => lk.room }));
vi.mock("./use-meeting-signals", () => ({ useMeetingSignals: () => signals }));
// Exits are motion's business; here a card leaves the DOM as soon as it leaves the stack.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => true,
}));

class FakeRoom extends EventEmitter {
  state = ConnectionState.Connected;
  remoteParticipants = new Map<string, { identity: string; name: string }>();
}

const person = (identity: string, name: string) => ({ identity, name, isAgent: false, attributes: {} });
const cards = () => [...document.querySelectorAll<HTMLElement>("[data-stage-notice]")];

function arrive(name: string) {
  act(() => {
    (lk.room as FakeRoom).emit(RoomEvent.ParticipantConnected, person(`id-${name}`, name));
    vi.advanceTimersByTime(10);
  });
}

const knock = (id: string, name: string) => ({ id, meeting_id: "m1", status: "PENDING", display_name_snapshot: name });

/** The door list the server answers with; approving or declining takes a knock off it. */
function serveKnocks(list: ReturnType<typeof knock>[]) {
  const door = { list };
  requestMock.mockImplementation((path: string) => {
    const decided = /meeting-join-requests\/(\w+)\/(approve|reject)$/.exec(path);
    if (decided) door.list = door.list.filter((r) => r.id !== decided[1]);
    return Promise.resolve(path === "/api/v1/meetings/m1/join-requests" ? { join_requests: door.list } : {});
  });
  return door;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  lk.room = new FakeRoom();
  signals.hands = [];
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MeetingStageToasts (UNI-2285 E)", () => {
  it("stage toasts stack newest first and cap at three", () => {
    vi.useFakeTimers();
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    // People already there when the room connects are not news.
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    for (const name of ["An", "Bình", "Chi", "Dũng"]) arrive(name);

    const shown = cards();
    expect(shown).toHaveLength(3);
    expect(shown[0]).toHaveTextContent("Dũng vào phòng");
    expect(shown[1]).toHaveTextContent("Chi vào phòng");
    expect(shown[2]).toHaveTextContent("Bình vào phòng");
    // Only the front card is reachable until the stack fans out.
    expect(shown[0]).not.toHaveAttribute("inert");
    expect(shown[1]).toHaveAttribute("inert");
  });

  it("hovering the stack pauses dismissal", () => {
    vi.useFakeTimers();
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    arrive("An");
    const stack = screen.getByTestId("meeting-stage-toasts");

    fireEvent.pointerEnter(stack);
    expect(stack).toHaveAttribute("data-open");
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).not.toHaveAttribute("inert");

    fireEvent.pointerLeave(stack);
    act(() => {
      vi.advanceTimersByTime(4800);
    });
    expect(cards()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(cards()).toHaveLength(0);
  });

  it("says who raised a hand and who left, but not our own hand", () => {
    vi.useFakeTimers();
    (lk.room as FakeRoom).remoteParticipants.set("id-mai", { identity: "id-mai", name: "Mai" });
    const view = render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    signals.hands = ["me", "id-mai"];
    view.rerender(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    act(() => {
      (lk.room as FakeRoom).emit(RoomEvent.ParticipantDisconnected, person("id-lan", "Lan"));
    });
    expect(cards().map((c) => c.dataset.stageNotice)).toEqual(["leave", "hand"]);
    expect(cards()[1]).toHaveTextContent("Mai giơ tay");
  });

  it("a full reconnect shows no one leaving", () => {
    vi.useFakeTimers();
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    arrive("An");
    // Reconnecting unwinds everyone first, then says so.
    act(() => {
      const room = lk.room as FakeRoom;
      room.emit(RoomEvent.ParticipantDisconnected, person("id-lan", "Lan"));
      room.emit(RoomEvent.ParticipantDisconnected, person("id-mai", "Mai"));
      room.emit(RoomEvent.Reconnecting);
    });
    expect(cards()).toHaveLength(0);
  });

  it("knock toast stays and admits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveKnocks([knock("jr1", "Anh Tuấn")]);
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" canAdmit />));
    const admit = await screen.findByRole("button", { name: "Cho Anh Tuấn vào" });
    expect(admit).toHaveTextContent("Cho vào");
    expect(cards()[0]).toHaveTextContent("Anh Tuấn xin vào");
    expect(cards()[0]).toHaveTextContent("Khách");

    // Past the five seconds passing news gets: a knock waits for a decision.
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(screen.getByRole("button", { name: "Cho Anh Tuấn vào" })).toBeInTheDocument();

    fireEvent.click(admit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr1/approve", { method: "POST" }),
    );
  });

  it("a knock stands in front of passing news", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveKnocks([knock("jr1", "Anh Tuấn")]);
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" canAdmit />));
    await screen.findByRole("button", { name: "Cho Anh Tuấn vào" });
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    arrive("An");
    arrive("Bình");
    expect(cards().map((c) => c.dataset.stageNotice)).toEqual(["knock", "join", "join"]);
    expect(cards()[1]).toHaveTextContent("Bình vào phòng");
  });

  it("the longest-waiting guests keep their cards", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const door = serveKnocks([knock("jr1", "An")]);
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" canAdmit />, undefined, client));
    await screen.findByRole("button", { name: "Cho An vào" });
    // Newest first from the server, one more knock each second.
    for (const [id, name] of [["jr2", "Bình"], ["jr3", "Chi"], ["jr4", "Dũng"]] as const) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      door.list = [knock(id, name), ...door.list];
      // Resolves once the door list is refetched.
      await act(() => client.invalidateQueries());
    }
    await waitFor(() => expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining("An xin vào"),
      expect.stringContaining("Bình xin vào"),
      expect.stringContaining("Chi xin vào"),
    ]));
  });

  it("admitting from the keyboard hands focus to the next guest, then out of the stack", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveKnocks([knock("jr1", "An"), knock("jr2", "Bình")]);
    render(
      wrapWithNav(
        <>
          <h1 data-stage-heading>Standup</h1>
          <MeetingStageToasts meetingId="m1" canAdmit />
        </>,
      ),
    );
    const stack = screen.getByTestId("meeting-stage-toasts");
    const first = await screen.findByRole("button", { name: "Cho An vào" });
    act(() => first.focus());
    expect(stack).toHaveAttribute("data-open");

    fireEvent.click(first);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cho Bình vào" })));
    expect(stack).toHaveAttribute("data-open");

    fireEvent.click(screen.getByRole("button", { name: "Cho Bình vào" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Standup" })));
    // Nothing holds the stack any more: it folds and its clock runs again.
    expect(stack).not.toHaveAttribute("data-open");
  });

  it("knock toast can turn the guest away", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/meetings/m1/join-requests"
          ? { join_requests: [{ id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Anh Tuấn" }] }
          : {},
      ),
    );
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" canAdmit />));
    // A quiet × beside "Cho vào", named for the guest it turns away.
    fireEvent.click(await screen.findByRole("button", { name: "Từ chối Anh Tuấn" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr1/reject", expect.objectContaining({ method: "POST" })),
    );
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr1/approve", expect.anything());
  });

  it("shows no knocks to someone who cannot let people in", async () => {
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    await new Promise((r) => setTimeout(r, 50));
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/join-requests");
    expect(cards()).toHaveLength(0);
  });
});
