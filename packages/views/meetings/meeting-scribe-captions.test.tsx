import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { requestMock, wrap } from "../test/api-mock";
import {
  applyScribeCaption,
  MeetingScribeCaptions,
  SCRIBE_CAPTION_TOPIC,
  scribeTranslationTopic,
  useScribeInRoom,
  useScribeJoinWait,
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
  activeSpeakers: [] as { audioLevel: number }[],
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
  useMeetingRoomPreferencesStore.setState({ captionPlacement: "docked", captionLines: 2, captionFloat: null });
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

/** The words a caption line shows: each word is its own span, so match the line's text as a whole. */
const shown = (text: string) =>
  screen.queryAllByText((_, el) => el?.hasAttribute("data-caption-text") === true && el.textContent === text)[0] ?? null;

/** The scribe's voice line along the bottom edge; it travels while a translation is awaited. */
const voiceLine = () => screen.getByTestId("meeting-scribe-captions").querySelector("[data-scribe-voice]");

const attrs = (identity: string, seg: string, final: boolean) => ({
  "uw.participant_identity": identity,
  "uw.segment_id": seg,
  "uw.final": final ? "1" : "0",
  "uw.language": "vi",
});

describe("applyScribeCaption", () => {
  it("replaces a segment's interim with its final, keeps a final over a late interim, and keeps fifty lines", () => {
    let lines = applyScribeCaption([], { segmentId: "a", identity: "p", text: "chốt", final: false });
    lines = applyScribeCaption(lines, { segmentId: "a", identity: "p", text: "chốt lịch", final: true });
    expect(lines).toEqual([{ segmentId: "a", identity: "p", text: "chốt lịch", final: true }]);
    lines = applyScribeCaption(lines, { segmentId: "a", identity: "p", text: "chốt", final: false });
    expect(lines[0]?.text).toBe("chốt lịch");
    for (let n = 1; n <= 50; n++) lines = applyScribeCaption(lines, { segmentId: `s${n}`, identity: "p", text: "x", final: true });
    expect(lines).toHaveLength(50);
    expect(lines[0]?.segmentId).toBe("s1");
    expect(lines.at(-1)?.segmentId).toBe("s50");
  });
});

describe("MeetingScribeCaptions", () => {
  it("shows who said what, interim dimmed then replaced by the final", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", false), "Chốt ship");
    expect(shown("Chốt ship")?.closest("[data-final]")).toHaveAttribute("data-final", "0");
    expect(screen.getByText("Lan")).toBeInTheDocument();
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Chốt ship thứ Sáu");
    expect(shown("Chốt ship")).toBeNull();
    expect(shown("Chốt ship thứ Sáu")?.closest("[data-final]")).toHaveAttribute("data-final", "1");
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Chốt ship thứ Sáu");
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Đồng ý");
    expect(screen.getByText("Minh")).toBeInTheDocument();
  });

  it("names the speaker when the voice changes, not on every line they say", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Chốt ship");
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-2", true), "thứ Sáu nhé");
    expect(screen.getAllByText("Lan")).toHaveLength(1);
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Đồng ý");
    expect(screen.getAllByText("Lan")).toHaveLength(1);
    expect(screen.getByText("Minh")).toBeInTheDocument();
    // Back to Lan after Minh: the voice changed again, so her name heads the line.
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-3", true), "Cảm ơn");
    expect(screen.getAllByText("Lan")).toHaveLength(2);
    expect(shown("Cảm ơn")?.closest("p")).toHaveTextContent("Lan");
  });

  it("says the scribe is on its way in, its line travelling, until it listens", () => {
    const { rerender } = render(wrap(<MeetingScribeCaptions enabled joining />));
    expect(screen.getByText("Thư ký UNI đang vào phòng")).toBeInTheDocument();
    expect(voiceLine()).toHaveAttribute("data-processing");
    expect(label().querySelector("[data-scribe-mark]")).toHaveAttribute("data-scribe-state", "joining");
    rerender(wrap(<MeetingScribeCaptions enabled />));
    expect(screen.getByText("Đang nghe…")).toBeInTheDocument();
    expect(voiceLine()).not.toHaveAttribute("data-processing");
    expect(label().querySelector("[data-scribe-mark]")).toHaveAttribute("data-scribe-state", "live");
  });

  it("lets the viewer scroll back: new lines wait below, the box opens, the arrow brings them down", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    for (let n = 1; n <= 5; n++) await caption("uw_agent_scribe", attrs("uw_participant_p1", `TR1-${n}`, true), `Câu ${n}`);
    const region = screen.getByRole("region", { name: "Phụ đề đã nói" });
    // jsdom lays nothing out: the lines are 300 px tall in a 70 px box scrolled to its bottom.
    let lineHeight = 300;
    let top = 230;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => lineHeight },
      clientHeight: { configurable: true, get: () => 70 },
      scrollTop: { configurable: true, get: () => top, set: (v: number) => (top = v) },
    });
    Object.defineProperty(region.firstElementChild, "offsetHeight", { configurable: true, get: () => lineHeight });
    const scrollTo = vi.fn();
    region.scrollTo = scrollTo as unknown as typeof region.scrollTo;
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-6", true), "Câu 6");
    expect(screen.queryByTestId("meeting-caption-latest")).not.toBeInTheDocument();
    fireEvent.wheel(region, { deltaY: -40 });
    const latest = await screen.findByRole("button", { name: "Về câu mới nhất" });
    expect(region).toHaveAttribute("data-reading");
    expect(screen.queryByTestId("meeting-caption-unseen")).not.toBeInTheDocument();
    // A new line while reading back does not pull the viewer down; the arrow says it came.
    lineHeight = 330;
    await caption("uw_agent_scribe", attrs("uw_participant_p2", "TR2-1", true), "Câu mới");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByTestId("meeting-caption-unseen")).toBeInTheDocument();
    // The arrow glides down while the box stays open; reaching the bottom follows again and shuts it.
    fireEvent.click(latest);
    expect(scrollTo).toHaveBeenCalledWith({ top: 330, behavior: "smooth" });
    expect(region).toHaveAttribute("data-reading");
    top = 260;
    fireEvent.scroll(region);
    expect(screen.queryByTestId("meeting-caption-latest")).not.toBeInTheDocument();
    expect(region).not.toHaveAttribute("data-reading");
  });

  it("follows again once the viewer scrolls back to the bottom themselves", async () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    for (let n = 1; n <= 4; n++) await caption("uw_agent_scribe", attrs("uw_participant_p1", `TR1-${n}`, true), `Câu ${n}`);
    const region = screen.getByRole("region", { name: "Phụ đề đã nói" });
    let top = 100;
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, get: () => 300 },
      clientHeight: { configurable: true, get: () => 70 },
      scrollTop: { configurable: true, get: () => top, set: (v: number) => (top = v) },
    });
    region.scrollTo = vi.fn() as unknown as typeof region.scrollTo;
    fireEvent.keyDown(region, { key: "ArrowUp" });
    expect(await screen.findByTestId("meeting-caption-latest")).toBeInTheDocument();
    top = 230;
    fireEvent.scroll(region);
    expect(screen.queryByTestId("meeting-caption-latest")).not.toBeInTheDocument();
  });

  it("floats over the stage and docks again from its grip, moved and resized by keys too", () => {
    const stage = document.createElement("div");
    stage.getBoundingClientRect = () => ({ left: 40, top: 60, width: 1000, height: 600, right: 1040, bottom: 660, x: 40, y: 60, toJSON: () => ({}) }) as DOMRect;
    render(wrap(<MeetingScribeCaptions enabled stage={stage} />));
    const root = screen.getByTestId("meeting-scribe-captions");
    const card = () => root.querySelector<HTMLElement>("[data-reading], .isolate")!;
    expect(root).toHaveAttribute("data-placement", "docked");
    // Docked, Shift + arrows show more or fewer whole lines.
    fireEvent.keyDown(screen.getByTestId("meeting-caption-grip"), { key: "ArrowUp", shiftKey: true });
    expect(useMeetingRoomPreferencesStore.getState().captionLines).toBe(3);
    expect(card().style.getPropertyValue("--cap-rows")).toBe("3.6");
    fireEvent.click(screen.getByRole("button", { name: "Tách khung phụ đề ra" }));
    expect(root).toHaveAttribute("data-placement", "floating");
    // Its first place: the stage's bottom-right corner, above the control bar.
    expect(card().style).toMatchObject({ left: "468px", top: "396px", width: "560px", height: "168px" });
    expect(screen.getAllByTestId(/meeting-caption-resize-/)).toHaveLength(8);
    fireEvent.keyDown(screen.getByTestId("meeting-caption-grip"), { key: "ArrowLeft" });
    expect(card().style.left).toBe("452px");
    fireEvent.keyDown(screen.getByTestId("meeting-caption-grip"), { key: "ArrowDown", shiftKey: true });
    expect(card().style.height).toBe("184px");
    expect(useMeetingRoomPreferencesStore.getState().captionFloat).toMatchObject({ x: 412, width: 560, height: 184 });
    fireEvent.click(screen.getByRole("button", { name: "Neo khung phụ đề lại" }));
    expect(root).toHaveAttribute("data-placement", "docked");
    expect(screen.queryAllByTestId(/meeting-caption-resize-[-0-9]/)).toHaveLength(0);
  });

  it("only docks without a stage to float over", () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    expect(screen.queryByTestId("meeting-caption-grip")).not.toBeInTheDocument();
    expect(screen.getByTestId("meeting-scribe-captions")).toHaveAttribute("data-placement", "docked");
  });

  it("lights its voice line from the room's loudest speaker", () => {
    render(wrap(<MeetingScribeCaptions enabled />));
    expect(voiceLine()).not.toBeNull();
    expect(voiceLine()).not.toHaveAttribute("data-processing");
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
    expect(voiceLine()).not.toHaveAttribute("data-processing");
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "en" } }),
    );
    expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true);
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Gửi báo giá");
    expect(shown("Gửi báo giá")).not.toBeNull();
    // A Vietnamese final waits for its English: the voice line travels, the thumb sweeps, the line
    // breathes, and the screen reader hears it once.
    expect(voiceLine()).toHaveAttribute("data-processing");
    expect(screen.getByTestId("meeting-caption-language-thumb")).toHaveClass("animate-caption-thumb-sweep");
    expect(shown("Gửi báo giá")).toHaveClass("animate-caption-breathe");
    expect(label()).not.toHaveTextContent("Đang dịch…");
    expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("Đang dịch…");
    // The line itself is held back from the screen reader until it is in the language it stays in.
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("");
    // Only the agent's translation counts.
    await caption("uw_participant_p2", { "uw.segment_id": "TR1-1" }, "Forged", scribeTranslationTopic("en"));
    expect(shown("Forged")).toBeNull();
    await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
    // The original lifts away first, then the translation runs in word by word.
    expect(shown("Gửi báo giá")?.querySelector(".animate-caption-word-out")).not.toBeNull();
    await waitFor(() => expect(shown("Send the quote")).not.toBeNull());
    const words = shown("Send the quote")?.querySelectorAll<HTMLElement>(".animate-caption-word-in");
    expect([...(words ?? [])].map((w) => w.style.animationDelay)).toEqual(["0ms", "18ms", "36ms"]);
    expect(voiceLine()).not.toHaveAttribute("data-processing");
    expect(screen.getByTestId("meeting-caption-language-thumb")).not.toHaveClass("animate-caption-thumb-sweep");
    expect(shown("Gửi báo giá")).toBeNull();
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Send the quote");
    // Back to the original.
    fireEvent.click(screen.getByRole("button", { name: "Bản gốc" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(false));
    await waitFor(() => expect(shown("Gửi báo giá")).not.toBeNull());
    expect(requestMock).toHaveBeenLastCalledWith("/api/v1/meetings/m1/caption-language", { method: "PUT", body: { lang: "" } });
  });

  it("promises nothing when the line is already in the picked language", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("vi"))).toBe(true));
    await caption("uw_agent_scribe", { ...attrs("uw_participant_p1", "TR1-1", true), "uw.language": "vi-VN" }, "Chốt lịch");
    expect(voiceLine()).not.toHaveAttribute("data-processing");
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
      expect(voiceLine()).toHaveAttribute("data-processing");
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(voiceLine()).not.toHaveAttribute("data-processing");
      expect(label()).toHaveTextContent("Chưa có bản dịch, đang hiện bản gốc");
      expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("Chưa có bản dịch, đang hiện bản gốc");
      expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Gửi báo giá");
      // A translation that turns up late changes the bar, never the line already read.
      await caption("uw_agent_scribe", { "uw.segment_id": "TR1-1" }, "Send the quote", scribeTranslationTopic("en"));
      act(() => {
        vi.advanceTimersByTime(170);
      });
      expect(shown("Send the quote")).not.toBeNull();
      expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Gửi báo giá");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says plainly that the AI quota is spent when the server will not translate, and stops waiting", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Bạn là ai?");
    expect(voiceLine()).toHaveAttribute("data-processing");
    const skip = { "uw.skipped": "ai_quota_exceeded", "uw.segment_ids": "TR1-1" };
    // Only the agent's word counts.
    await caption("uw_participant_p2", skip, "ai_quota_exceeded", scribeTranslationTopic("en"));
    expect(screen.queryByTestId("meeting-caption-skipped")).not.toBeInTheDocument();
    await caption("uw_agent_scribe", skip, "ai_quota_exceeded", scribeTranslationTopic("en"));
    expect(screen.getByTestId("meeting-caption-skipped")).toHaveTextContent("Tổ chức đã hết hạn mức AI, phụ đề hiện bản gốc");
    expect(voiceLine()).not.toHaveAttribute("data-processing");
    expect(shown("Bạn là ai?")).not.toHaveClass("animate-caption-breathe");
    expect(screen.getByTestId("meeting-caption-translation-notice")).toHaveTextContent("Tổ chức đã hết hạn mức AI");
    // No five-second wait for a translation that will not come: the line is read now, in the original.
    expect(screen.getByTestId("meeting-caption-announcer")).toHaveTextContent("Lan: Bạn là ai?");
  });

  it("names a switched-off translation, and says anything else plainly", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(lk.handlers.has(scribeTranslationTopic("en"))).toBe(true));
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-1", true), "Chốt lịch");
    await caption("uw_agent_scribe", { "uw.skipped": "unavailable", "uw.segment_ids": "TR1-1" }, "unavailable", scribeTranslationTopic("en"));
    expect(screen.getByTestId("meeting-caption-skipped")).toHaveTextContent("Tổ chức chưa bật phụ đề dịch");
    await caption("uw_agent_scribe", attrs("uw_participant_p1", "TR1-2", true), "Gửi báo giá");
    await caption("uw_agent_scribe", { "uw.skipped": "capped", "uw.segment_ids": "TR1-2" }, "capped", scribeTranslationTopic("en"));
    expect(screen.getByTestId("meeting-caption-skipped")).toHaveTextContent("Chưa có bản dịch, đang hiện bản gốc");
  });

  it("slides a thumb, measured, under the picked language behind short labels", async () => {
    render(wrap(<MeetingScribeCaptions enabled meetingId="m1" />));
    const original = screen.getByRole("button", { name: "Bản gốc" });
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(original).toHaveTextContent("Gốc");
    const english = screen.getByRole("button", { name: "English" });
    expect(english).toHaveTextContent("EN");
    const thumb = screen.getByTestId("meeting-caption-language-thumb");
    expect(thumb).toHaveAttribute("data-language", "original");
    // jsdom lays nothing out, so the button's own offsets stand in for the measured ones.
    Object.defineProperty(english, "offsetLeft", { configurable: true, value: 84 });
    Object.defineProperty(english, "offsetWidth", { configurable: true, value: 38 });
    fireEvent.click(english);
    expect(thumb).toHaveAttribute("data-language", "en");
    expect(thumb.style.transform).toBe("translateX(84px)");
    expect(thumb.style.width).toBe("38px");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
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

describe("useScribeJoinWait", () => {
  it("holds a joining scribe for 30 s, then lets device captions in, and starts afresh the next time", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      function Probe({ onItsWay }: { onItsWay: boolean }) {
        return <span data-testid="wait">{String(useScribeJoinWait(onItsWay))}</span>;
      }
      const view = render(<Probe onItsWay />);
      const wait = () => screen.getByTestId("wait");
      expect(wait()).toHaveTextContent("true");
      act(() => {
        vi.advanceTimersByTime(29_999);
      });
      expect(wait()).toHaveTextContent("true");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(wait()).toHaveTextContent("false");
      // It arrived, then left and is on its way again: a new wait.
      view.rerender(<Probe onItsWay={false} />);
      expect(wait()).toHaveTextContent("false");
      view.rerender(<Probe onItsWay />);
      expect(wait()).toHaveTextContent("true");
    } finally {
      vi.useRealTimers();
    }
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
