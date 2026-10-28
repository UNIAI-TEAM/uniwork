import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { StripJobRow, type StripHandlers } from "../strip-rows";
import { demoUser, demoWorkspace, detailValue, fixtureMeeting, routeMeeting } from "../test-fixtures";
import { RsvpFaces, StartCountdown, type RsvpFace } from "./start-countdown";

const motionPrefs = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (orig) => ({
  ...(await orig<typeof import("motion/react")>()),
  useReducedMotion: () => motionPrefs.reduced,
}));

const startsAt = "2026-10-29T10:00:00.000Z";
const at = (msBefore: number) => new Date(Date.parse(startsAt) - msBefore);

afterEach(() => {
  vi.useRealTimers();
  motionPrefs.reduced = false;
});

describe("StartCountdown", () => {
  it("ring empties with the time left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(30 * 60_000));
    const { container } = render(<StartCountdown startsAt={startsAt} />);
    expect(container.querySelector("svg[data-progress]")).toHaveAttribute("data-progress", "0.5");
    expect(screen.getByRole("timer", { name: "Bắt đầu sau 30:00" })).toBeInTheDocument();
    expect(screen.getByText(/^Bắt đầu \d\d:\d\d$/)).toBeInTheDocument();
  });

  it("countdown jumps right after sleep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(30 * 60_000));
    const { container } = render(<StartCountdown startsAt={startsAt} />);
    // The tab sleeps ten minutes with no tick; the next tick reads the wall clock.
    vi.setSystemTime(at(20 * 60_000));
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.getByRole("timer", { name: "Bắt đầu sau 19:59" })).toBeInTheDocument();
    expect(container.querySelector("svg[data-progress]")).toHaveAttribute("data-progress", "0.333");
  });
});

const face = (id: string, name: string, state: RsvpFace["state"]): RsvpFace => ({ id, name, state, tint: "blue" });

describe("RsvpFaces", () => {
  it("an accepted face moves to the front and the waiting count drops", () => {
    vi.useFakeTimers();
    const before = [face("lp", "Lan Phạm", "ACCEPTED"), face("hv", "Hà Vũ", "PENDING"), face("mt", "Minh Trần", "PENDING")];
    const { container, rerender } = render(<RsvpFaces faces={before} />);
    const order = () => [...container.querySelectorAll("[data-face]")].map((el) => el.getAttribute("data-face"));
    const waiting = () => container.querySelector("[data-slot=rsvp-waiting]")!;
    expect(order()).toEqual(["lp", "hv", "mt"]);
    expect(container.querySelector("[data-face=hv]")).toHaveAttribute("data-state", "PENDING");
    expect(waiting()).toHaveTextContent(/2\s*chờ/);
    expect(screen.getByText("2 người chưa phản hồi: Hà Vũ, Minh Trần")).toBeInTheDocument();

    rerender(<RsvpFaces faces={before.map((f) => (f.id === "hv" ? { ...f, state: "ACCEPTED" } : f))} />);
    expect(order()).toEqual(["hv", "lp", "mt"]);
    expect(container.querySelector("[data-face=hv]")).toHaveAttribute("data-state", "ACCEPTED");
    expect(container.querySelector("[data-face=hv] .lucide-check")).not.toBeNull();
    expect(waiting()).toHaveTextContent(/1\s*chờ/);
    expect(screen.getByText("1 người chưa phản hồi: Minh Trần")).toBeInTheDocument();

    // The ✓ is a moment, not a state.
    act(() => {
      vi.advanceTimersByTime(1_300);
    });
    rerender(<RsvpFaces faces={before.map((f) => (f.id === "hv" ? { ...f, state: "ACCEPTED" } : f))} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.querySelector("[data-face=hv] .lucide-check")).toBeNull();
  });

  it("puts yes answers first on the first render, and says nothing when nobody waits", () => {
    const { container } = render(<RsvpFaces faces={[face("hv", "Hà Vũ", "DECLINED"), face("lp", "Lan Phạm", "ACCEPTED")]} />);
    expect([...container.querySelectorAll("[data-face]")].map((el) => el.getAttribute("data-face"))).toEqual(["lp", "hv"]);
    expect(container.querySelector("[data-slot=rsvp-waiting]")).toBeNull();
    expect(container.querySelector(".lucide-check")).toBeNull();
  });
});

describe("StartRow", () => {
  const handlers: StripHandlers = {
    onJoin: () => {},
    onEnd: () => {},
    onReview: () => {},
    onFinalize: () => {},
    onEdit: () => {},
    onFollowUpCreated: () => {},
    hostName: "Lan Phạm",
    clerkNames: [],
  };
  const m3 = fixtureMeeting("m3");
  const renderStart = (minutesBefore: number): ReactElement => {
    const now = Date.parse(m3.starts_at) - minutesBefore * 60_000;
    vi.setSystemTime(now);
    return wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
        <DetailContext.Provider value={detailValue("m3", { user: "lan", now })}>
          <StripJobRow job={{ kind: "start", canStart: true, pendingNames: ["Minh Trần"], inPerson: false, canRecord: false }} handlers={handlers} />
        </DetailContext.Provider>
      </WorkspaceProvider>,
    );
  };

  it("start button glows only when due", () => {
    vi.useFakeTimers();
    routeMeeting("m3", { viewer: "lan" });
    setSessionUser(demoUser("lan"));
    const early = render(renderStart(30));
    // Inside the hour the row leads with the countdown and the faces instead of the sentence.
    expect(early.container.querySelector("svg[data-progress]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Bắt đầu họp" })).not.toHaveClass("border-beam");
    early.unmount();

    const due = render(renderStart(5));
    const button = screen.getByRole("button", { name: "Bắt đầu họp" });
    expect(button).toHaveClass("border-beam");
    expect(button).toHaveAttribute("data-motion-loop");
    due.unmount();

    motionPrefs.reduced = true;
    render(renderStart(5));
    const still = screen.getByRole("button", { name: "Bắt đầu họp" });
    expect(still).not.toHaveClass("border-beam");
    expect(still).not.toHaveAttribute("data-motion-loop");
  });

  it("keeps the sentence more than an hour ahead", () => {
    vi.useFakeTimers();
    routeMeeting("m3", { viewer: "lan" });
    setSessionUser(demoUser("lan"));
    const { container } = render(renderStart(90));
    expect(container.querySelector("svg[data-progress]")).toBeNull();
    expect(screen.getByText(/Minh Trần/)).toBeInTheDocument();
  });
});
