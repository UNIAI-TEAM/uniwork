import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { meetingKeys } from "@uniwork/core/meetings";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav, fakeNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, routeMeeting } from "../test-fixtures";
import { OverviewTab } from "./overview-tab";
import { beamPassAt } from "./summary-composing";
import { wordStep } from "./summary-points";

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduce,
}));

const m1 = demo.meetings.m1;
const M1 = m1.meeting.id;
const base = `/api/v1/meetings/${M1}`;
const summary = m1.summary.summary;
const idle = { status: "idle", at: null, attempts: 0, failure: null };
const running = { status: "running", at: "2026-10-22T02:31:00Z", attempts: 1 };
const caps = { [`/api/v1/workspaces/${demoWorkspace.id}/meeting-capabilities`]: { ai_summary: true } };
// Seven lines, a minute apart from 09:01 ICT.
const segments = Array.from({ length: 7 }, (_, i) => ({
  id: `s${i + 1}`,
  meeting_id: M1,
  speaker_name: i % 2 ? "Minh Trần" : "Lan Phạm",
  text: `Câu thứ ${i + 1}`,
  spoken_at: `2026-10-22T02:0${i + 1}:00Z`,
}));
const liveItem = { id: "ai-live", source: "LIVE", title: "Gửi hóa đơn", status: "PENDING", evidence: [{ kind: "segment", id: "s2" }] };
const points = [
  { text: "Nhóm chốt khóa tính năng ngày 30/10.", evidence: [{ kind: "segment", id: "s1" }] },
  { text: "Ngân sách sự kiện là 350 triệu.", evidence: [{ kind: "segment", id: "s4" }] },
];

function show(extra: Record<string, unknown>, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const routes: Record<string, unknown> = {
    ...caps,
    [`${base}/transcript`]: { segments },
    [`${base}/action-items`]: { items: [], counts: {} },
    [`${base}/evidence`]: { items: [{ kind: "segment", id: "s4", author: "Lan Phạm", text: "Ngân sách tổng là 350 triệu đồng.", at: "2026-10-22T02:10:00Z" }] },
    ...extra,
  };
  routeMeeting("m1", { viewer: "lan", extra: routes });
  setSessionUser(demoUser("lan"));
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser("lan")}>
        <DetailContext.Provider value={detailValue("m1", { user: "lan" })}>
          <OverviewTab />
        </DetailContext.Provider>
      </WorkspaceProvider>,
      fakeNav(`/sao-mai/van-hanh/meetings/${M1}`),
      client,
    ),
  );
  return { routes, client };
}

const cardLines = (card: HTMLElement) => within(card).getAllByRole("listitem", { hidden: true }).map((li) => li.querySelector("[data-line-text]")?.textContent);

beforeAll(() => vi.stubEnv("TZ", "Asia/Ho_Chi_Minh"));
beforeEach(() => {
  requestMock.mockReset();
  motion.reduce = false;
});

describe("Tóm tắt › composing, reveal and sources (F)", () => {
  it("composing card sweeps the last five lines", async () => {
    show({ [`${base}/summary`]: { summary: null, run: running } });
    const card = await screen.findByTestId("summary-composing");
    expect(within(card).getByText("Đang soạn tóm tắt")).toHaveClass("ai-shimmer");
    await waitFor(() => expect(cardLines(card)).toEqual(["Câu thứ 3", "Câu thứ 4", "Câu thứ 5", "Câu thứ 6", "Câu thứ 7"]));
    // No line Thư ký UNI cited live: the beam sweeps, nothing is marked.
    expect(card.querySelector("[data-cited]")).toBeNull();
    expect(card.querySelector("[data-beam][data-motion-loop]")).not.toBeNull();
    expect(within(card).getByText("7 câu thoại")).toBeInTheDocument();
  });

  it("each line comes up to full colour as the beam first crosses it", async () => {
    show({ [`${base}/summary`]: { summary: null, run: running } });
    const card = await screen.findByTestId("summary-composing");
    await waitFor(() => expect(card.querySelectorAll("li[data-read]")).toHaveLength(5));
    const rows = [...card.querySelectorAll<HTMLElement>("li")];
    expect(rows.every((li) => li.classList.contains("text-foreground"))).toBe(true);
    const delays = rows.map((li) => parseFloat(li.style.transitionDelay));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(delays[0]).toBeCloseTo(beamPassAt(0, 5));
    // The last line is lit before the beam's first pass ends.
    expect(delays[4]).toBeLessThan(2.4);
  });

  it("word reveal keeps the clip's 34ms step and lands within 2.4s", () => {
    expect(wordStep(20)).toBeCloseTo(0.034);
    // 200 words: the step shrinks so the last one starts by 2.4s - 420ms.
    expect(199 * wordStep(200) + 0.42).toBeLessThanOrEqual(2.4 + 1e-9);
  });

  it("marks the lines Thư ký UNI cited in the room, keeping them among the five", async () => {
    show({
      [`${base}/summary`]: { summary: null, run: running },
      [`${base}/action-items`]: { items: [liveItem, { ...liveItem, id: "ai-later", source: "AI", evidence: [{ kind: "segment", id: "s1" }] }], counts: {} },
    });
    const card = await screen.findByTestId("summary-composing");
    await waitFor(() => expect(cardLines(card)).toEqual(["Câu thứ 2", "Câu thứ 4", "Câu thứ 5", "Câu thứ 6", "Câu thứ 7"]));
    // Only the live item's evidence counts: an AI item from the summary is not what the scribe heard.
    expect([...card.querySelectorAll("[data-cited]")].map((el) => el.textContent)).toEqual(["Câu thứ 2"]);
  });

  it("summary reveals word by word only after composing in this session", async () => {
    const { routes, client } = show({ [`${base}/summary`]: { summary: null, run: running } });
    await screen.findByTestId("summary-composing");
    routes[`${base}/summary`] = { summary, run: idle };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    const prose = await waitFor(() => {
      const el = document.querySelector("[data-reveal]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(prose.textContent).toBe(summary.summary);
  });

  it("a regenerate that fails leaves the old summary still, its byline back", async () => {
    const { routes, client } = show({ [`${base}/summary`]: { summary: null, run: running } });
    await screen.findByTestId("summary-composing");
    // A first run lands and writes itself in…
    routes[`${base}/summary`] = { summary, run: idle };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    await waitFor(() => expect(document.querySelector("[data-reveal]")).not.toBeNull());
    // …then "Soạn lại" runs and fails: the same summary comes back without replaying.
    routes[`${base}/summary`] = { summary, run: running };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    await screen.findByTestId("summary-composing");
    // The old summary's credit leaves with its prose while Thư ký UNI rewrites.
    expect(screen.queryByTestId("ai-attribution")).toBeNull();
    routes[`${base}/summary`] = { summary, run: { ...idle, attempts: 1, failure: { code: "ai_unavailable" } } };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    await waitFor(() => expect(screen.queryByTestId("summary-composing")).toBeNull());
    expect(await screen.findByTestId("ai-attribution")).toBeInTheDocument();
    expect(document.querySelector("[data-reveal]")).toBeNull();
  });

  it("a regenerate that lands a new summary reveals it", async () => {
    const { routes, client } = show({ [`${base}/summary`]: { summary, run: running } });
    await screen.findByTestId("summary-composing");
    const fresh = { ...summary, id: "sum-new", summary: "Bản tóm tắt mới." };
    // A refetch mid-run already carries the new summary; the run ends on the next one.
    routes[`${base}/summary`] = { summary: fresh, run: running };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    routes[`${base}/summary`] = { summary: fresh, run: idle };
    await act(() => client.invalidateQueries({ queryKey: meetingKeys.summary(M1) }));
    await waitFor(() => expect(document.querySelector("[data-reveal]")?.textContent).toBe("Bản tóm tắt mới."));
  });

  it("shows a summary already there at once, with no reveal", async () => {
    show({ [`${base}/summary`]: { summary, run: idle } });
    expect(await screen.findByText(summary.summary)).toBeInTheDocument();
    expect(document.querySelector("[data-reveal]")).toBeNull();
    expect(screen.queryByTestId("summary-composing")).toBeNull();
  });

  it("points carry numbered sources and open the cited lines", async () => {
    show({ [`${base}/summary`]: { summary: { ...summary, summary: points.map((p) => p.text).join(" "), summary_points: points }, run: idle } });
    const one = await screen.findByRole("button", { name: "Nguồn 1" });
    const two = screen.getByRole("button", { name: "Nguồn 2" });
    expect(one).toHaveTextContent("1");
    expect(two.closest("[data-point]")).toHaveTextContent(points[1]!.text);
    fireEvent.click(two);
    const pop = await screen.findByRole("dialog", { name: "Nguồn 2" });
    expect(await within(pop).findByText("“Ngân sách tổng là 350 triệu đồng.”")).toBeInTheDocument();
    expect(within(pop).getByText("Lan Phạm")).toBeInTheDocument();
    expect(within(pop).getByText("09:10:00")).toBeInTheDocument();
    // The compact quote keeps the way into the transcript.
    expect(within(pop).getByRole("button", { name: /Mở trong lời thoại/ })).toBeInTheDocument();
  });

  it("numbers only the sources shown, so a point without evidence leaves no gap", async () => {
    const three = [points[0]!, { text: "Chưa rõ ai lo phần âm thanh.", evidence: [] }, points[1]!];
    show({ [`${base}/summary`]: { summary: { ...summary, summary: three.map((p) => p.text).join(" "), summary_points: three }, run: idle } });
    await screen.findByRole("button", { name: "Nguồn 1" });
    expect(screen.getAllByRole("button", { name: /^Nguồn/ }).map((b) => b.textContent)).toEqual(["1", "2"]);
    expect(screen.getByRole("button", { name: "Nguồn 2" }).closest("[data-point]")).toHaveTextContent(points[1]!.text);
  });

  it("old summary without points renders as one paragraph", async () => {
    show({ [`${base}/summary`]: { summary: { ...summary, summary_points: [] }, run: idle } });
    const p = await screen.findByText(summary.summary);
    expect(p.tagName).toBe("P");
    expect(screen.queryByRole("button", { name: /^Nguồn/ })).toBeNull();
  });

  it("reduced motion leaves no loops", async () => {
    motion.reduce = true;
    show({ [`${base}/summary`]: { summary: null, run: running } });
    const card = await screen.findByTestId("summary-composing");
    await waitFor(() => expect(cardLines(card)).toHaveLength(5));
    expect(document.querySelector("[data-motion-loop]")).toBeNull();
    expect(within(card).getByText("Đang soạn tóm tắt")).not.toHaveClass("ai-shimmer");
    // Lines are lit from the start: nothing waits for a beam that does not run.
    expect(card.querySelectorAll("li[data-read]")).toHaveLength(5);
  });
});
