import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setSessionUser } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import type { NavigationAdapter } from "../../../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext, type DetailContextValue } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, routeMeeting, type DemoUserKey, type MeetingFixtureKey } from "../test-fixtures";
import { OverviewTab } from "./overview-tab";

const m1 = demo.meetings.m1;
const M1 = m1.meeting.id;
const base = `/api/v1/meetings/${M1}`;
const summary = m1.summary.summary;
const decision2 = summary.decisions[1]!;
const idle = { status: "idle", at: null, attempts: 0, failure: null };
const caps = { [`/api/v1/workspaces/${demoWorkspace.id}/meeting-capabilities`]: { ai_summary: true } };
// The full transcript the page reads: the line decision 2 rests on first, at 09:06:31 ICT.
const transcript = {
  [`${base}/transcript`]: {
    segments: [{ id: decision2.evidence[0]!.id, meeting_id: M1, text: "Ừ, hai lỗi đó…", spoken_at: "2026-10-22T02:06:31Z" }],
  },
};
const evidence = {
  [`${base}/evidence`]: {
    items: [
      { kind: "segment", id: decision2.evidence[0]!.id, author: "Lan Phạm", text: "Ừ, hai lỗi đó phải sửa trước ngày khóa tính năng.", at: "2026-10-22T02:06:31Z" },
      { kind: "segment", id: "s2", author: "Minh Trần", text: "Vâng.", at: "2026-10-22T02:06:40Z" },
      { kind: "segment", id: "s3", author: "Hà Vũ", text: "Đúng.", at: "2026-10-22T02:06:50Z" },
      { kind: "note", id: "n1", author: "Hà Vũ", text: "Khóa tính năng 30/10.", at: "2026-10-22T02:18:54Z" },
    ],
  },
};

function renderOverview(
  key: MeetingFixtureKey = "m1",
  {
    viewer,
    extra = {},
    value = {},
    nav = fakeNav(`/sao-mai/van-hanh/meetings/${M1}`),
  }: { viewer?: DemoUserKey; extra?: Record<string, unknown>; value?: Partial<DetailContextValue>; nav?: NavigationAdapter } = {},
) {
  const who = viewer ?? (key === "m1Outsider" ? "tuan" : "lan");
  routeMeeting(key, { viewer: who, extra: { ...caps, ...transcript, ...evidence, ...extra } });
  setSessionUser(demoUser(who));
  const ui: ReactElement = (
    <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
      <DetailContext.Provider value={detailValue(key, { user: who, ...value })}>
        <OverviewTab />
      </DetailContext.Provider>
    </WorkspaceProvider>
  );
  return { nav, ...render(wrapWithNav(ui, nav)) };
}

const posted = () => requestMock.mock.calls.some(([p, init]) => String(p) === `${base}/summary` && (init as { method?: string } | undefined)?.method === "POST");

beforeAll(() => {
  // The page reads clocks in the viewer's zone; the demo is in Hà Nội.
  vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
});

beforeEach(() => {
  requestMock.mockReset();
});

describe("OverviewTab › ended meeting (Main)", () => {
  it("heads the summary with who asked for it, when, and from what, muted until the minutes are final", async () => {
    renderOverview();
    const line = await screen.findByTestId("ai-attribution");
    await waitFor(() => expect(line).toHaveTextContent("Soạn 09:31 22/10 theo yêu cầu của Lan Phạm · từ 1 câu thoại và 2 ghi chú ·"));
    // No name in the line: the scribe's mark leads it, named for screen readers and on hover.
    expect(line.parentElement).toHaveTextContent(/^Thư ký UNI: Soạn 09:31/);
    expect(line).toHaveAttribute("title", "claude-opus-5");
    expect(screen.getByRole("button", { name: "Soạn lại" })).toBeInTheDocument();
    expect(screen.getByText(summary.summary)).toHaveClass("text-muted-foreground");
    // No AI badge, no "Căn cứ N" chip: the byline and the time chips say it.
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Căn cứ/ })).toBeNull();
  });

  it("orders the sections Tóm tắt → Việc cần làm → Quyết định → Câu hỏi còn mở → Chủ đề → Ghi chú", async () => {
    renderOverview();
    await screen.findByRole("heading", { name: "Quyết định" });
    const ids = [...document.querySelectorAll("section[id]")].map((s) => s.id).filter((id) => id !== "" && !id.startsWith("base-ui"));
    const at = (id: string) => ids.indexOf(id);
    expect(at("summary")).toBe(0);
    expect(at("decisions")).toBeGreaterThan(at("summary"));
    expect(at("open-questions")).toBeGreaterThan(at("decisions"));
    expect(at("topics")).toBeGreaterThan(at("open-questions"));
    expect(await screen.findByText(m1.action_items.items[1]!.title)).toBeInTheDocument();
  });

  it("turns the prose to foreground ink and drops Soạn lại once the minutes are final", async () => {
    renderOverview("m1", { extra: { [`${base}/minutes`]: { minutes: { ...m1.minutes.minutes, finalized: true } } } });
    await waitFor(() => expect(screen.getByText(summary.summary)).toHaveClass("text-foreground"));
    expect(screen.queryByRole("button", { name: "Soạn lại" })).toBeNull();
  });

  it("shows 8 decisions, then Xem thêm 2, each AI claim timed by its first line", async () => {
    renderOverview();
    const section = await screen.findByRole("region", { name: "Quyết định" });
    expect(within(section).getByText("10")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(8);
    const chip = await within(section).findByRole("button", { name: "Xem căn cứ lúc 09:06, 4 căn cứ" });
    expect(chip).toHaveTextContent("09:06");
    // "+3" is for the eye; the count is in the chip's name.
    expect(within(chip.closest("li")!).getByText("+3")).toHaveAttribute("aria-hidden");
    fireEvent.click(within(section).getByRole("button", { name: "Xem thêm 2" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(10);
    expect(within(section).getByRole("button", { name: "Thu gọn" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the evidence: who said it and when, the line, what else it rests on, and the transcript at that line", async () => {
    const { nav } = renderOverview();
    fireEvent.click(await screen.findByRole("button", { name: "Xem căn cứ lúc 09:06, 4 căn cứ" }));
    const pop = await screen.findByRole("dialog", { name: "Căn cứ lúc 09:06" });
    expect(await within(pop).findByText("Lan Phạm")).toBeInTheDocument();
    expect(within(pop).getByText("09:06:31")).toBeInTheDocument();
    expect(within(pop).getByText("“Ừ, hai lỗi đó phải sửa trước ngày khóa tính năng.”")).toBeInTheDocument();
    expect(within(pop).getByText("+2 câu thoại · 1 ghi chú của Hà Vũ")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Mở trong lời thoại" }));
    const page = paths.workspace(demoWorkspace.organization_slug, demoWorkspace.slug).meeting(M1);
    expect(nav.push).toHaveBeenCalledWith(`${page}?tab=transcript&segment=${decision2.evidence[0]!.id}`);
  });

  it("links the two questions that wait for next week to the next meeting, and only those", async () => {
    const next = { ...demo.meetings.m3.meeting, id: "01NEXT", title: "Giao ban tuần 44" };
    renderOverview("m1", {
      value: { meeting: { ...detailValue("m1").meeting, next_meeting_id: "01NEXT" } },
      extra: { "/api/v1/meetings/01NEXT": { meeting: next } },
    });
    const section = await screen.findByRole("region", { name: "Câu hỏi còn mở" });
    await waitFor(() => expect(within(section).getAllByRole("link", { name: "Bàn ở: Giao ban tuần 44" })).toHaveLength(2));
    expect(within(section).getAllByRole("listitem")).toHaveLength(4);
  });

  it("says nothing about a next meeting the series does not have", async () => {
    renderOverview();
    const section = await screen.findByRole("region", { name: "Câu hỏi còn mở" });
    expect(within(section).queryByRole("link")).toBeNull();
  });

  it("folds each topic to its title and point count, its points one click away", async () => {
    renderOverview();
    const section = await screen.findByRole("region", { name: "Chủ đề" });
    const topic = within(section).getByRole("button", { name: /^Rà soát việc tồn tuần trước/ });
    expect(topic).toHaveAttribute("aria-expanded", "false");
    expect(topic).toHaveTextContent("2 ý");
    expect(within(section).getByRole("button", { name: "Xem căn cứ lúc 09:01" })).toBeInTheDocument();
    fireEvent.click(topic);
    expect(within(section).getByText(summary.topics[0]!.points[0]!.text)).toBeInTheDocument();
  });

  it("offers a member no Soạn lại", async () => {
    renderOverview("m1", { viewer: "minh" });
    await screen.findByTestId("ai-attribution");
    expect(screen.queryByRole("button", { name: "Soạn lại" })).toBeNull();
  });

  it("shows an outsider the assigned work only, never reading the summary", async () => {
    renderOverview("m1Outsider");
    expect(await screen.findByText(demo.m1_as_outsider.action_items.items[0]!.title)).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-summary-panel")).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => String(p).startsWith(`${base}/summary`))).toBe(false);
  });
});

describe("OverviewTab › regenerate", () => {
  it("asks before Soạn lại replaces the summary", async () => {
    renderOverview();
    const redo = await screen.findByRole("button", { name: "Soạn lại" });
    await waitFor(() => expect(redo).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(redo);
    const dialog = await screen.findByRole("alertdialog");
    expect(posted()).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo lại" }));
    await waitFor(() => expect(posted()).toBe(true));
  });

  it("keeps a failed rewrite's copy on the section, never the server's message, with a retry", async () => {
    const answer = (path: unknown, init?: { method?: string }) =>
      String(path) === `${base}/summary` && init?.method === "POST" ? Promise.reject(new ApiError("pgx: raw", "internal", 500)) : null;
    renderOverview();
    const route = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((p: unknown, init?: { method?: string }) => answer(p, init) ?? route(p, init));
    const redo = await screen.findByRole("button", { name: "Soạn lại" });
    await waitFor(() => expect(redo).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(redo);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tạo lại" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Chưa tạo được tóm tắt. Thử lại.");
    expect(alert).not.toHaveTextContent("pgx");
    expect(within(alert).getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("says when the transcript changed, more came in, or only part was read", async () => {
    renderOverview("m1", {
      extra: {
        [`${base}/summary`]: {
          summary: { ...summary, partial: true, transcript_changed_at: "2026-10-22T05:00:00Z", created_at: "2026-10-22T02:10:00Z" },
          run: idle,
        },
      },
    });
    expect(await screen.findByText("Lời thoại đã thay đổi sau khi tóm tắt này được tạo.")).toBeInTheDocument();
    expect(await screen.findByText("Có dữ liệu mới sau khi tạo tóm tắt")).toBeInTheDocument();
    expect(screen.getByText(/^Tóm tắt dựa trên một phần cuộc họp/)).toBeInTheDocument();
  });

  it("marks a summary the system made when the meeting ended", async () => {
    renderOverview("m1", { extra: { [`${base}/summary`]: { summary: { ...summary, created_by_kind: "system" }, run: idle } } });
    await waitFor(() => expect(screen.getByTestId("ai-attribution")).toHaveTextContent("Tự soạn 09:31 22/10 khi cuộc họp kết thúc"));
  });
});

describe("OverviewTab › AI states (AfterAIStates)", () => {
  const empty = { [`${base}/action-items`]: { items: [], counts: {} } };

  it("c1: says the scribe is writing, and when the items come", async () => {
    renderOverview("m1", {
      extra: { ...empty, [`${base}/summary`]: { summary: null, run: { status: "running", at: "2026-10-22T02:31:00Z", attempts: 1 } } },
    });
    expect(await screen.findByText(/^Đang soạn tóm tắt/)).toBeInTheDocument();
    expect(await screen.findByText("Việc cần làm có sau khi soạn xong")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quyết định" })).toBeNull();
  });

  it("c2: no summary yet: what it would read, and a button to write it", async () => {
    renderOverview("m1", { extra: { ...empty, [`${base}/summary`]: { summary: null, run: idle } } });
    expect(await screen.findByText("Chưa có tóm tắt cho cuộc họp này.")).toBeInTheDocument();
    expect(await screen.findByText("Việc cần làm có sau khi soạn tóm tắt")).toBeInTheDocument();
    const write = await screen.findByRole("button", { name: "Soạn tóm tắt" });
    await waitFor(() => expect(write).not.toHaveAttribute("aria-disabled"));
    expect(screen.getByText("Thư ký UNI soạn từ 1 câu thoại và 2 ghi chú")).toBeInTheDocument();
    fireEvent.click(write);
    await waitFor(() => expect(posted()).toBe(true));
  });

  it("c2: a member is told there is none, with nothing to press", async () => {
    renderOverview("m1", { viewer: "minh", extra: { ...empty, [`${base}/summary`]: { summary: null, run: idle } } });
    expect(await screen.findByText("Chưa có tóm tắt cho cuộc họp này.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Soạn tóm tắt" })).toBeNull();
  });

  it("c3: the second failed attempt, a retry, and what still reads", async () => {
    renderOverview("m1", {
      extra: {
        ...empty,
        [`${base}/summary`]: { summary: null, run: { ...idle, attempts: 2, failure: { code: "ai_failed", at: "2026-10-22T02:33:00Z" } } },
      },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Chưa soạn được tóm tắt (lần 2).");
    await waitFor(() => expect(alert).toHaveTextContent("Lời thoại 1 câu và 2 ghi chú vẫn xem được bình thường"));
    expect(within(alert).getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.getByText("Việc cần làm có sau khi soạn được tóm tắt")).toBeInTheDocument();
  });

  it("c4: with the scribe off, no Tóm tắt; the notes come before the items", async () => {
    renderOverview("m1", {
      value: { meeting: { ...detailValue("m1").meeting, scribe_enabled: false } },
      extra: { ...empty, [`${base}/summary`]: { summary: null, run: idle } },
    });
    expect(await screen.findAllByText(m1.notes[0]!.body)).not.toHaveLength(0);
    expect(screen.queryByTestId("meeting-summary-panel")).toBeNull();
    expect(screen.queryByText(/có sau khi soạn/)).toBeNull();
  });

  it("holds the section's shape while the summary loads, and offers a retry when it fails", async () => {
    renderOverview("m1", { extra: { [`${base}/summary`]: new Promise(() => {}) } });
    expect(within(screen.getByTestId("meeting-summary-panel")).getByText("Đang tải…")).toBeInTheDocument();
  });

  it("shows what was voted even without an AI summary", async () => {
    const motion = {
      id: "mo1",
      title: "Thông qua kế hoạch quý IV",
      description: "",
      position: 1,
      ballot_mode: "PUBLIC",
      threshold: "MAJORITY",
      base: "PRESENT",
      status: "CLOSED",
      closed_at: "2026-10-22T02:20:00Z",
      roll_size: 4,
      total_members: 5,
      cast_count: 4,
      result: { yes: 3, no: 1, abstain: 0, required: 3, outcome: "PASSED" },
      voters: null,
      my_ballot: { on_roll: true, cast: true, choice: "YES" },
    };
    renderOverview("m1", { extra: { [`${base}/summary`]: { summary: null, run: idle }, [`${base}/motions`]: { motions: [motion] } } });
    const section = await screen.findByRole("region", { name: "Quyết định" });
    expect(within(section).getByText("Đã biểu quyết")).toBeInTheDocument();
    expect(within(section).getByText("Thông qua kế hoạch quý IV")).toBeInTheDocument();
    expect(within(section).getByText("09:20")).toBeInTheDocument();
    expect(within(section).getByText("Thông qua")).toBeInTheDocument();
    for (const count of ["3 tán thành", "1 không tán thành", "0 không ý kiến", "Cần 3/4 phiếu tán thành"]) {
      expect(within(section).getByText(count)).toBeInTheDocument();
    }
  });
});

describe("OverviewTab › phone (PhoneAfter)", () => {
  it("clamps the prose behind Đọc tiếp's control, 3 decisions open and the rest folded", async () => {
    renderOverview("m1", { value: { isPhone: true } });
    expect(await screen.findByText(summary.summary)).toHaveClass("line-clamp-4");
    const decisions = await screen.findByRole("button", { name: /^Quyết định/ });
    expect(decisions).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Xem thêm 7" })).toBeInTheDocument();
    const questions = screen.getByRole("button", { name: /^Câu hỏi còn mở/ });
    expect(questions).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(questions);
    expect(screen.getByText(summary.open_questions[0]!.text)).toBeInTheDocument();
  });

  it("folds the notes into the accordion and ends it with Lịch sử thao tác", async () => {
    renderOverview("m1", { value: { isPhone: true } });
    const note = m1.notes[0]!.body;
    const notes = await screen.findByRole("button", { name: /^Ghi chú/ });
    expect(notes).toHaveAttribute("aria-expanded", "false");
    expect(notes).toHaveTextContent(String(m1.notes.length));
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(notes);
    expect(screen.getByText(note)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lịch sử thao tác" }));
    expect(await screen.findByRole("dialog", { name: "Lịch sử thao tác" })).toBeInTheDocument();
  });

  it("keeps the notes open with no recap to fold them into (AfterAIStates c1)", async () => {
    renderOverview("m1", {
      value: { isPhone: true },
      extra: {
        [`${base}/action-items`]: { items: [], counts: {} },
        [`${base}/summary`]: { summary: null, run: { status: "running", at: "2026-10-22T02:31:00Z", attempts: 1 } },
      },
    });
    expect(await screen.findByText(m1.notes[0]!.body)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ghi chú/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lịch sử thao tác" })).toBeNull();
  });

  it("opens the evidence as a bottom sheet", async () => {
    renderOverview("m1", { value: { isPhone: true } });
    fireEvent.click(await screen.findByRole("button", { name: "Xem căn cứ lúc 09:06, 4 căn cứ" }));
    expect(await screen.findByText("“Ừ, hai lỗi đó phải sửa trước ngày khóa tính năng.”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeInTheDocument();
  });
});
