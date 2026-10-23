import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import {
  applyScribeCaption,
  MeetingScribeCaptions,
  SCRIBE_CAPTION_TOPIC,
  scribeTranslationTopic,
  useScribeInRoom,
  useScribePaused,
} from "./meeting-scribe-captions";
import { humanParticipants } from "./meeting-signals";

type Handler = (reader: { info: { attributes?: Record<string, string> }; readAll: () => Promise<string> }, from: { identity: string }) => void;

const lk = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  people: new Map<string, { identity: string; name: string; isAgent?: boolean }>(),
  remote: [] as { identity: string; isAgent?: boolean; attributes?: Record<string, string> }[],
  remoteOptions: [] as unknown[],
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
  useRemoteParticipants: (options?: unknown) => {
    lk.remoteOptions.push(options);
    return lk.remote;
  },
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  lk.remote = [];
  lk.remoteOptions = [];
  lk.handlers.clear();
  lk.people.clear();
  lk.people.set("uw_agent_scribe", { identity: "uw_agent_scribe", name: "UniWork AI", isAgent: true });
  lk.people.set("uw_participant_p1", { identity: "uw_participant_p1", name: "Lan" });
  lk.people.set("uw_participant_p2", { identity: "uw_participant_p2", name: "Minh" });
});

async function caption(from: string, attrs: Record<string, string>, text: string, topic = SCRIBE_CAPTION_TOPIC) {
  const h = lk.handlers.get(topic);
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
    render(wrap(<MeetingScribeCaptions enabled />));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", false), "Chốt ship");
    const interim = screen.getByText("Chốt ship");
    expect(interim.closest("[data-final]")).toHaveAttribute("data-final", "0");
    expect(screen.getByText("Lan:", { exact: false })).toBeInTheDocument();
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Chốt ship thứ Sáu");
    expect(screen.queryByText("Chốt ship")).not.toBeInTheDocument();
    expect(screen.getByText("Chốt ship thứ Sáu").closest("[data-final]")).toHaveAttribute("data-final", "1");
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Chốt ship thứ Sáu");
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Đồng ý");
    expect(screen.getAllByText("Minh:", { exact: false }).length).toBeGreaterThan(0);
  });

  it("ignores captions sent by anyone but the agent", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    await caption("uw_participant_p2", attrs("uw_participant_p1", "x-1", true), "Giả mạo");
    expect(screen.queryByText("Giả mạo")).not.toBeInTheDocument();
  });

  it("keeps the language switch in the stage's dark scope, whatever the app theme", () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    expect(screen.getByRole("button", { name: "Bản gốc" }).closest(".dark")).not.toBeNull();
  });

  it("listens only while on", () => {
    const { rerender } = render(wrap(<MeetingScribeCaptions enabled={false} />));
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(false);
    rerender(wrap(<MeetingScribeCaptions enabled />));
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(true);
    rerender(wrap(<MeetingScribeCaptions enabled={false} />));
    expect(lk.handlers.has(SCRIBE_CAPTION_TOPIC)).toBe(false);
  });
});

/** The bar's visible caption label, where the translation state shows. */
const label = () => screen.getByTestId("meeting-caption-label");

describe("MeetingScribeCaptions translation (B9)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ status: "ok" });
  });

  it("asks the server for the language, reads its topic and shows the original until a translation arrives", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    // Nothing waits for a translation yet: no promise of one.
    expect(label()).not.toHaveTextContent("Đang dịch…");
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "en" } }),
    );
    expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true);
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Gửi báo giá");
    expect(screen.getByText("Gửi báo giá")).toBeInTheDocument();
    // A Vietnamese final waits for its English: the bar says so, the screen reader hears it once.
    expect(label()).toHaveTextContent("Đang dịch…");
    expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("Đang dịch…");
    // The line itself is held back from the screen reader until it is in the language it stays in.
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("");
    // Only the agent's translation counts.
    await caption("uw_participant_p2", { "uw.segment_id": "TR1-1" }, "Forged", scribeTranslationTopic("en"));
    expect(screen.queryByText("Forged")).not.toBeInTheDocument();
    await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
    expect(screen.getByText("Send the quote")).toBeInTheDocument();
    expect(label()).not.toHaveTextContent("Đang dịch…");
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Send the quote");
    // Back to the original.
    fireEvent.click(screen.getByRole("button", { name: "Bản gốc" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(false));
    expect(screen.getByText("Gửi báo giá")).toBeInTheDocument();
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "" } });
  });

  it("promises nothing when the line is already in the picked language", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("vi"))).toBe(true));
    await caption("uw_agent_scribe", { ...attrs("uw_participant_p1", "TR1-1", true), "uw.language": "vi-VN" }, "Chốt lịch");
    expect(label()).not.toHaveTextContent("Đang dịch…");
    expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("");
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Chốt lịch");
  });

  it("still reads a line whose translation lands after a newer line that needed none", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Gửi báo giá");
    await caption("uw_agent_scribe", { ...attrs("uw_participant_p2", "TR1-2", true), "uw.language": "en" }, "Agreed");
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Minh: Agreed");
    await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Send the quote");
  });

  it("says plainly that the original shows when no translation comes, and reads the line once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
      fireEvent.click(screen.getByRole("button", { name: "English" }));
      await act(async () => {});
      expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true);
      await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Gửi báo giá");
      expect(label()).toHaveTextContent("Đang dịch…");
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(label()).not.toHaveTextContent("Đang dịch…");
      expect(label()).toHaveTextContent("Chưa có bản dịch, đang hiện bản gốc");
      expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("Chưa có bản dịch, đang hiện bản gốc");
      expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Gửi báo giá");
      // A translation that turns up late changes the bar, never the line already read.
      await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
      expect(screen.getByText("Send the quote")).toBeInTheDocument();
      expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Gửi báo giá");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the picked language with more than a grey: the brand fill and a tick", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    const original = screen.getByRole("button", { name: "Bản gốc" });
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(original.className).toMatch(/aria-pressed:bg-brand\b/);
    expect(original.className).toMatch(/aria-pressed:font-semibold/);
    expect(original.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "English" }).querySelector("svg")).toBeNull();
  });

  it("goes back to the original when the server refuses", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    requestMock.mockRejectedValueOnce(new Error("feature_disabled"));
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Bản gốc" })).toHaveAttribute("aria-pressed", "true");
    expect(lk.handlers.has(scribeTranslationTopic("vi"))).toBe(false);
    error.mockRestore();
  });

  it("clears the language when the captions close, so the agent stops translating", async () => {
    const { unmount } = render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() =>
      expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "" } }),
    );
  });

  it("says nothing when the reset on close is refused: the room is closing anyway", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { unmount } = render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    requestMock.mockRejectedValueOnce(new Error("meeting_ended"));
    unmount();
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("sends picks one at a time, so the server and the picker end on the last one", async () => {
    let finishEnglish: (v: unknown) => void = () => {};
    requestMock.mockReturnValueOnce(new Promise((res) => (finishEnglish = res)));
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Bản gốc" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // Gốc waits for English: sent together they could land in the other order.
    expect(requestMock).toHaveBeenCalledTimes(1);
    await act(async () => finishEnglish({ status: "ok" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls.map((c) => (c[1] as { body: unknown }).body)).toEqual([{ lang: "en" }, { lang: "" }]);
    expect(screen.getByRole("button", { name: "Bản gốc" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a late refusal of an older pick leaves the newer one alone", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    let refuseEnglish: (e: unknown) => void = () => {};
    requestMock.mockReturnValueOnce(new Promise((_, rej) => (refuseEnglish = rej)));
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    await act(async () => refuseEnglish(new Error("feature_disabled")));
    await waitFor(() => expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "vi" } }));
    expect(screen.getByRole("button", { name: "Tiếng Việt" })).toHaveAttribute("aria-pressed", "true");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("has no language picker without a meeting", () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    expect(screen.queryByRole("button", { name: "English" })).not.toBeInTheDocument();
  });
});

describe("useScribeInRoom", () => {
  it("follows joins and leaves only: a speaking change must not re-render the stage", () => {
    function Probe() {
      return <span data-testid="scribe">{String(useScribeInRoom())}</span>;
    }
    lk.remote = [{ identity: "uw_participant_p1" }, { identity: "uw_agent_scribe", isAgent: true }];
    render(<Probe />);
    expect(screen.getByTestId("scribe")).toHaveTextContent("true");
    expect(lk.remoteOptions[0]).toEqual({ updateOnlyOn: [] });
  });
});

describe("useScribePaused", () => {
  it("reads the agent's own uw.scribe_state and follows attribute changes", () => {
    function Probe() {
      return <span data-testid="paused">{String(useScribePaused())}</span>;
    }
    // Only the agent's attribute counts: nobody else can pause the scribe for the room.
    lk.remote = [
      { identity: "uw_participant_p1", attributes: { "uw.scribe_state": "degraded" } },
      { identity: "uw_agent_scribe", isAgent: true, attributes: { "uw.scribe_state": "ok" } },
    ];
    const view = render(<Probe />);
    expect(screen.getByTestId("paused")).toHaveTextContent("false");
    expect(lk.remoteOptions[0]).toEqual({ updateOnlyOn: ["participantAttributesChanged"] });
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true, attributes: { "uw.scribe_state": "degraded" } }];
    view.rerender(<Probe />);
    expect(screen.getByTestId("paused")).toHaveTextContent("true");
  });
});

describe("humanParticipants", () => {
  it("drops LiveKit AGENT participants", () => {
    const people = [{ identity: "a" }, { identity: "uw_agent_scribe", isAgent: true }, { identity: "b", isAgent: false }];
    expect(humanParticipants(people).map((p) => p.identity)).toEqual(["a", "b"]);
  });
});
