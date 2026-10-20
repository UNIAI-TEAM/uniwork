import { act, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { applyScribeCaption, MeetingScribeCaptions, SCRIBE_CAPTION_TOPIC } from "./meeting-scribe-captions";
import { humanParticipants } from "./meeting-signals";

type Handler = (reader: { info: { attributes?: Record<string, string> }; readAll: () => Promise<string> }, from: { identity: string }) => void;

const lk = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  people: new Map<string, { identity: string; name: string; isAgent?: boolean }>(),
  remote: [] as { identity: string; isAgent?: boolean }[],
}));

const room = {
  registerTextStreamHandler: (topic: string, h: Handler) => {
    if (lk.handlers.has(topic)) throw new Error("registered twice");
    lk.handlers.set(topic, h);
  },
  unregisterTextStreamHandler: (topic: string) => lk.handlers.delete(topic),
  getParticipantByIdentity: (id: string) => lk.people.get(id),
};

vi.mock("@livekit/components-react", () => ({
  useRoomContext: () => room,
  useRemoteParticipants: () => lk.remote,
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  lk.handlers.clear();
  lk.people.clear();
  lk.people.set("uw_agent_scribe", { identity: "uw_agent_scribe", name: "UniWork AI", isAgent: true });
  lk.people.set("uw_participant_p1", { identity: "uw_participant_p1", name: "Lan" });
  lk.people.set("uw_participant_p2", { identity: "uw_participant_p2", name: "Minh" });
});

async function caption(from: string, attrs: Record<string, string>, text: string) {
  const h = lk.handlers.get(SCRIBE_CAPTION_TOPIC);
  if (!h) throw new Error("no handler");
  await act(async () => {
    h({ info: { attributes: attrs }, readAll: () => Promise.resolve(text) }, { identity: from });
    await Promise.resolve();
  });
}

const attrs = (identity: string, seg: string, final: boolean) => ({
  "uw.participant_identity": identity,
  "uw.segment_id": seg,
  "uw.final": final ? "1" : "0",
  "uw.language": "vi",
});

describe("applyScribeCaption", () => {
  it("replaces a segment's interim with its final, keeps a final over a late interim, and keeps three lines", () => {
    let lines = applyScribeCaption([], { segmentId: "a", identity: "p", text: "chốt", final: false });
    lines = applyScribeCaption(lines, { segmentId: "a", identity: "p", text: "chốt lịch", final: true });
    expect(lines).toEqual([{ segmentId: "a", identity: "p", text: "chốt lịch", final: true }]);
    lines = applyScribeCaption(lines, { segmentId: "a", identity: "p", text: "chốt", final: false });
    expect(lines[0]?.text).toBe("chốt lịch");
    for (const id of ["b", "c", "d"]) lines = applyScribeCaption(lines, { segmentId: id, identity: "p", text: id, final: true });
    expect(lines.map((l) => l.segmentId)).toEqual(["b", "c", "d"]);
  });
});

describe("MeetingScribeCaptions", () => {
  it("shows who said what, interim dimmed then replaced by the final", async () => {
    render(<MeetingScribeCaptions enabled />);
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", false), "Chốt ship");
    const interim = screen.getByText("Chốt ship");
    expect(interim.closest("[data-final]")).toHaveAttribute("data-final", "0");
    expect(screen.getByText("Lan:", { exact: false })).toBeInTheDocument();
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Chốt ship thứ Sáu");
    expect(screen.queryByText("Chốt ship")).not.toBeInTheDocument();
    expect(screen.getByText("Chốt ship thứ Sáu").closest("[data-final]")).toHaveAttribute("data-final", "1");
    expect(screen.getByRole("status")).toHaveTextContent("Lan: Chốt ship thứ Sáu");
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Đồng ý");
    expect(screen.getAllByText("Minh:", { exact: false }).length).toBeGreaterThan(0);
  });

  it("ignores captions sent by anyone but the agent", async () => {
    render(<MeetingScribeCaptions enabled />);
    await caption("uw_participant_p2", attrs("uw_participant_p1", "x-1", true), "Giả mạo");
    expect(screen.queryByText("Giả mạo")).not.toBeInTheDocument();
  });

  it("listens only while on", () => {
    const { rerender } = render(<MeetingScribeCaptions enabled={false} />);
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(false);
    rerender(<MeetingScribeCaptions enabled />);
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(true);
    rerender(<MeetingScribeCaptions enabled={false} />);
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(false);
  });
});

describe("humanParticipants", () => {
  it("drops LiveKit AGENT participants", () => {
    const people = [{ identity: "a" }, { identity: "uw_agent_scribe", isAgent: true }, { identity: "b", isAgent: false }];
    expect(humanParticipants(people).map((p) => p.identity)).toEqual(["a", "b"]);
  });
});
