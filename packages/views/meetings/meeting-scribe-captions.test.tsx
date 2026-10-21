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
} from "./meeting-scribe-captions";
import { humanParticipants } from "./meeting-signals";

type Handler = (reader: { info: { attributes?: Record<string, string> }; readAll: () => Promise<string> }, from: { identity: string }) => void;

const lk = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  people: new Map<string, { identity: string; name: string; isAgent?: boolean }>(),
  remote: [] as { identity: string; isAgent?: boolean }[],
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
    expect(screen.getByRole("status")).toHaveTextContent("Lan: Chốt ship thứ Sáu");
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Đồng ý");
    expect(screen.getAllByText("Minh:", { exact: false }).length).toBeGreaterThan(0);
  });

  it("ignores captions sent by anyone but the agent", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    await caption("uw_participant_p2", attrs("uw_participant_p1", "x-1", true), "Giả mạo");
    expect(screen.queryByText("Giả mạo")).not.toBeInTheDocument();
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

describe("MeetingScribeCaptions translation (B9)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ status: "ok" });
  });

  it("asks the server for the language, reads its topic and shows the original until a translation arrives", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "en" } }),
    );
    expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true);
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Gửi báo giá");
    expect(screen.getByText("Gửi báo giá")).toBeInTheDocument();
    // Only the agent's translation counts.
    await caption("uw_participant_p2", { "uw.segment_id": "TR1-1" }, "Forged", scribeTranslationTopic("en"));
    expect(screen.queryByText("Forged")).not.toBeInTheDocument();
    await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
    expect(screen.getByText("Send the quote")).toBeInTheDocument();
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    // Back to the original.
    fireEvent.click(screen.getByRole("button", { name: "Gốc" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(false));
    expect(screen.getByText("Gửi báo giá")).toBeInTheDocument();
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "" } });
  });

  it("goes back to the original when the server refuses", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    requestMock.mockRejectedValueOnce(new Error("feature_disabled"));
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Gốc" })).toHaveAttribute("aria-pressed", "true");
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

  it("sends picks one at a time, so the server and the picker end on the last one", async () => {
    let finishEnglish: (v: unknown) => void = () => {};
    requestMock.mockReturnValueOnce(new Promise((res) => (finishEnglish = res)));
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Gốc" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // Gốc waits for English: sent together they could land in the other order.
    expect(requestMock).toHaveBeenCalledTimes(1);
    await act(async () => finishEnglish({ status: "ok" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls.map((c) => (c[1] as { body: unknown }).body)).toEqual([{ lang: "en" }, { lang: "" }]);
    expect(screen.getByRole("button", { name: "Gốc" })).toHaveAttribute("aria-pressed", "true");
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

describe("humanParticipants", () => {
  it("drops LiveKit AGENT participants", () => {
    const people = [{ identity: "a" }, { identity: "uw_agent_scribe", isAgent: true }, { identity: "b", isAgent: false }];
    expect(humanParticipants(people).map((p) => p.identity)).toEqual(["a", "b"]);
  });
});
