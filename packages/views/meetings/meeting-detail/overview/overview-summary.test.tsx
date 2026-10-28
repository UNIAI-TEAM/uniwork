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
  });
});
