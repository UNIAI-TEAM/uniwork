import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EventEmitter } from "events";
import type { ReactNode } from "react";
import { ConnectionState, RoomEvent } from "livekit-client";
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

  it("knock toast stays and admits", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/meetings/m1/join-requests"
          ? { join_requests: [{ id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Anh Tuấn" }] }
          : {},
      ),
    );
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" canAdmit />));
    const admit = await screen.findByRole("button", { name: "Cho Anh Tuấn vào" });
    expect(admit).toHaveTextContent("Cho vào");
    expect(cards()[0]).toHaveTextContent("Anh Tuấn xin vào");
    expect(cards()[0]).toHaveTextContent("Khách");

    // Past the five seconds passing news gets: a knock waits for a decision.
    await new Promise((r) => setTimeout(r, 5200));
    expect(screen.getByRole("button", { name: "Cho Anh Tuấn vào" })).toBeInTheDocument();

    fireEvent.click(admit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meeting-join-requests/jr1/approve", { method: "POST" }),
    );
  }, 10_000);

  it("shows no knocks to someone who cannot let people in", async () => {
    render(wrapWithNav(<MeetingStageToasts meetingId="m1" />));
    await new Promise((r) => setTimeout(r, 50));
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/join-requests");
    expect(cards()).toHaveLength(0);
  });
});
