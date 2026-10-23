import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { initI18n } from "@uniwork/core/i18n";
import { meetingKeys } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types/meeting";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingSummaryPanel } from "./meeting-summary-panel";

beforeAll(() => {
  initI18n();
});

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Kế hoạch quý",
  starts_at: "2026-09-22T02:00:00Z",
  ends_at: "2026-09-22T04:00:00Z",
  status: "ENDED",
  host_user_id: "u-host",
} as Meeting;

const running = { status: "running", at: "2026-09-22T04:01:00Z", attempts: 1 };
const idle = { status: "idle", at: null, attempts: 0 };

function respond(summary: () => unknown) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
    if (p.endsWith("/summary") && init?.method === "POST") return Promise.reject(new Error("must not post"));
    if (p.endsWith("/summary")) return Promise.resolve(summary());
    if (p.endsWith("/transcript")) {
      return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Ngân sách", spoken_at: "2026-09-22T02:10:00Z" }] });
    }
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    return Promise.resolve({});
  });
}

describe("MeetingSummaryPanel › a summary the server is making (UNI-1995 #12)", () => {
  it("shows every reader that a summary is on its way, and says so politely", async () => {
    respond(() => ({ summary: null, run: running }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk={false} />));

    const panel = screen.getByTestId("meeting-summary-panel");
    expect(await within(panel).findByTestId("summary-run-generating")).toHaveTextContent("Đang tạo tóm tắt…");
    expect(within(panel).queryByText("Chưa có tóm tắt.")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đang tạo tóm tắt. Có thể mất tới một phút."),
    );
  });

  it("holds the clerk's Generate still while the server runs one, instead of a 409", async () => {
    respond(() => ({ summary: null, run: running }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />));

    const button = await screen.findByRole("button", { name: "Đang tóm tắt…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/summary", expect.objectContaining({ method: "POST" }));
  });

  it("says the summary is ready when the server's run lands one", async () => {
    let state: unknown = { summary: null, run: running };
    respond(() => state);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk={false} />, undefined, client));
    await screen.findByTestId("summary-run-generating");

    // summary.created invalidates the key, as the realtime sync does.
    state = { summary: { id: "s1", meeting_id: "m1", summary: "Chốt ngân sách." }, run: idle };
    await client.invalidateQueries({ queryKey: meetingKeys.summary("m1") });

    expect(await screen.findByText("Chốt ngân sách.")).toBeInTheDocument();
    expect(screen.queryByTestId("summary-run-generating")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đã tạo tóm tắt."));
  });
});

describe("MeetingSummaryPanel › a clerk's run outlives the click (UNI-1995 #12)", () => {
  /** GET answers `state`; POST starts a run (202) and answers `started`. */
  function respondStart(started: () => unknown) {
    let state: unknown = { summary: null, run: idle };
    requestMock.mockReset();
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (p.endsWith("/meeting-capabilities")) return Promise.resolve({ ai_summary: true });
      if (p.endsWith("/summary") && init?.method === "POST") {
        state = { summary: null, run: running };
        return Promise.resolve(started());
      }
      if (p.endsWith("/summary")) return Promise.resolve(state);
      if (p.endsWith("/transcript")) {
        return Promise.resolve({ segments: [{ id: "t1", meeting_id: "m1", text: "Ngân sách", spoken_at: "2026-09-22T02:10:00Z" }] });
      }
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({});
    });
    return (next: unknown) => {
      state = next;
    };
  }

  async function clickGenerate(client: QueryClient) {
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk />, undefined, client));
    const button = await screen.findByRole("button", { name: "Tạo tóm tắt" });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(button);
  }

  it("keeps saying it is being made after the server took the run, then shows how it failed", async () => {
    const setState = respondStart(() => ({ summary: null, run: running }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await clickGenerate(client);
    expect(await screen.findByRole("button", { name: "Đang tóm tắt…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("summary-live-region")).not.toHaveTextContent("Đã tạo tóm tắt.");

    // The run ends on the server; the poll (here, an invalidation) reads it.
    setState({ summary: null, run: { ...idle, failure: { code: "ai_timeout", at: "2026-09-22T04:03:00Z" } } });
    await client.invalidateQueries({ queryKey: meetingKeys.summary("m1") });

    const panel = screen.getByTestId("meeting-summary-panel");
    await waitFor(() => expect(panel).toHaveTextContent("AI trả lời quá lâu"));
    expect(within(panel).getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đang tóm tắt…" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("summary-live-region")).toHaveTextContent("AI trả lời quá lâu"));
  });

  it("says the summary is ready when the started run lands it", async () => {
    const setState = respondStart(() => ({ summary: null, run: running }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await clickGenerate(client);
    await screen.findByRole("button", { name: "Đang tóm tắt…" });
    expect(screen.getByTestId("summary-live-region")).not.toHaveTextContent("Đã tạo tóm tắt.");

    setState({ summary: { id: "s1", meeting_id: "m1", summary: "Chốt ngân sách." }, run: idle });
    await client.invalidateQueries({ queryKey: meetingKeys.summary("m1") });

    expect(await screen.findByText("Chốt ngân sách.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đã tạo tóm tắt."));
  });

  it("shows the failure of a run that ended before the answer came back", async () => {
    respondStart(() => ({ summary: null, run: { ...idle, failure: { code: "ai_failed", at: "2026-09-22T04:01:00Z" } } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await clickGenerate(client);
    const panel = screen.getByTestId("meeting-summary-panel");
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Thử lại" })).toBeInTheDocument());
  });
});

describe("MeetingSummaryPanel › topics and open questions (meeting_summary@7)", () => {
  it("renders each topic with when it started and its cited points, then the open questions", async () => {
    respond(() => ({
      run: idle,
      summary: {
        id: "s1",
        meeting_id: "m1",
        summary: "Họp chốt ngân sách quý 4 và lịch tuyển dụng.",
        topics: [
          {
            title: "Ngân sách quý 4",
            start: { kind: "segment", id: "t1" },
            start_at: "2026-09-22T02:10:00Z",
            points: [{ text: "Đề xuất 2 tỷ cho marketing", evidence: [{ kind: "segment", id: "t1" }] }],
          },
          { title: "Tuyển dụng", start: null, start_at: null, points: [{ text: "Mở 3 vị trí", evidence: [] }] },
        ],
        open_questions: [{ text: "Ai duyệt kế hoạch tuyển dụng?", evidence: [{ kind: "segment", id: "t1" }] }],
      },
    }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk={false} />));

    expect(await screen.findByText("Họp chốt ngân sách quý 4 và lịch tuyển dụng.")).toBeInTheDocument();
    const topics = screen.getByRole("list", { name: "Chủ đề" });
    const [budget, hiring] = within(topics).getAllByRole("listitem", { name: /./ });
    expect(within(budget!).getByRole("heading", { name: "Ngân sách quý 4" })).toBeInTheDocument();
    // The time opens the line the topic starts at.
    expect(within(budget!).getByRole("button", { name: /^Bắt đầu lúc .+: xem lời thoại$/ })).toBeInTheDocument();
    expect(within(budget!).getByText("Đề xuất 2 tỷ cho marketing")).toBeInTheDocument();
    expect(within(budget!).getByRole("button", { name: "Căn cứ 1 nguồn" })).toBeInTheDocument();
    expect(within(hiring!).queryByRole("button", { name: /^Bắt đầu lúc/ })).not.toBeInTheDocument();
    expect(within(hiring!).getByText("Mở 3 vị trí")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Vấn đề còn mở" })).toBeInTheDocument();
    expect(screen.getByText("Ai duyệt kế hoạch tuyển dụng?")).toBeInTheDocument();
  });

  it("keeps an older summary without topics as it was", async () => {
    respond(() => ({ run: idle, summary: { id: "s1", meeting_id: "m1", summary: "Chốt lịch." } }));
    render(wrapWithNav(<MeetingSummaryPanel workspaceId="w1" meeting={meeting} canClerk={false} />));
    expect(await screen.findByText("Chốt lịch.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Chủ đề" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Vấn đề còn mở" })).not.toBeInTheDocument();
  });
});
