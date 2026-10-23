import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { playJoinRequestChime } from "./join-request-chime";
import { MeetingAdmitGuestsButton } from "./meeting-admit-guests-button";

vi.mock("./join-request-chime", () => ({ playJoinRequestChime: vi.fn() }));

const MUTE_KEY = "uniwork_meeting_join_chime_muted";
const PANEL = "meeting-join-request-notice";
const CHIME = "Âm báo khi có người xin vào";

beforeAll(() => {
  initI18n();
});

function request(id: string, name: string): MeetingJoinRequest {
  return { id, meeting_id: "m1", status: "PENDING", display_name_snapshot: name };
}

/** The chip inside a stand-in stage header, fed by the join-requests endpoint. */
function renderChip(pending: MeetingJoinRequest[], props: { peopleOpen?: boolean; onOpenPeople?: () => void } = {}) {
  requestMock.mockResolvedValue({ join_requests: pending });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (p: typeof props) =>
    wrapWithNav(
      <QueryClientProvider client={client}>
        <div data-testid="meeting-stage-header">
          <h1 data-stage-heading>Standup</h1>
          <MeetingAdmitGuestsButton meetingId="m1" {...p} />
        </div>
        {/* Stand-in for the people tab's waiting list. */}
        {p.peopleOpen ? (
          <h3 id="waiting-admission-heading">
            <button type="button">Đang chờ vào phòng</button>
          </h3>
        ) : null}
      </QueryClientProvider>,
    );
  const view = render(ui(props));
  return {
    ...view,
    /** Serves a new queue (as a realtime event would) and re-renders with new props. */
    async update(next: MeetingJoinRequest[], nextProps = props) {
      requestMock.mockResolvedValue({ join_requests: next });
      view.rerender(ui(nextProps));
      await act(async () => {
        await client.invalidateQueries();
      });
    },
  };
}

describe("join-request panel under the stage header", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(playJoinRequestChime).mockClear();
    window.localStorage.removeItem(MUTE_KEY);
  });

  it("states the count on the chip and shows the decision in a dark panel, with one chime", async () => {
    const { update } = renderChip([request("jr1", "kim kim")]);

    expect(await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cho kim kim vào" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối kim kim" })).toBeInTheDocument();
    expect(screen.getByTestId(PANEL)).toHaveClass("dark");
    expect(screen.queryByRole("button", { name: /Xem tất cả/ })).not.toBeInTheDocument();
    expect(playJoinRequestChime).toHaveBeenCalledOnce();

    await update([request("jr1", "kim kim")]);
    await screen.findByRole("button", { name: "Cho kim kim vào" });
    expect(playJoinRequestChime).toHaveBeenCalledOnce();
  });

  it("hides until someone new knocks, and hands focus back to the chip", async () => {
    const { update } = renderChip([request("jr1", "kim kim")]);
    const hide = await screen.findByRole("button", { name: "Ẩn thông báo" });
    act(() => hide.focus());
    fireEvent.click(hide);

    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "1 người đang chờ, xem danh sách" })).toHaveFocus());

    await update([request("jr1", "kim kim"), request("jr2", "lan")]);
    expect(await screen.findByTestId(PANEL)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "2 người đang chờ, xem danh sách" })).toBeInTheDocument();
    expect(playJoinRequestChime).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape", async () => {
    renderChip([request("jr1", "kim kim")]);
    const admit = await screen.findByRole("button", { name: "Cho kim kim vào" });
    act(() => admit.focus());
    fireEvent.keyDown(admit, { key: "Escape" });
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  it("steps aside while the people tab is open and counts those knocks as seen", async () => {
    const { update } = renderChip([request("jr1", "kim kim")], { peopleOpen: true });
    expect(await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" })).toBeInTheDocument();
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();

    await update([request("jr1", "kim kim")], { peopleOpen: false });
    await screen.findByRole("button", { name: "1 người đang chờ, xem danh sách" });
    expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument();
  });

  it("follows view-all into the people tab's list", async () => {
    const onOpenPeople = vi.fn();
    const { update } = renderChip([request("jr1", "kim kim"), request("jr2", "lan")], { onOpenPeople });
    const viewAll = await screen.findByRole("button", { name: "Xem tất cả (2)" });
    act(() => viewAll.focus());
    fireEvent.click(viewAll);
    expect(onOpenPeople).toHaveBeenCalledOnce();

    await update([request("jr1", "kim kim"), request("jr2", "lan")], { onOpenPeople, peopleOpen: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Đang chờ vào phòng" })).toHaveFocus());
  });

  it("names the sound toggle once and reports its state with aria-pressed, remembered per browser", async () => {
    const { update } = renderChip([request("jr1", "kim kim")]);
    const bell = await screen.findByRole("button", { name: CHIME });
    expect(bell).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: CHIME })).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(MUTE_KEY)).toBe("1");

    await update([request("jr1", "kim kim"), request("jr2", "lan")]);
    await screen.findByRole("button", { name: "2 người đang chờ, xem danh sách" });
    expect(playJoinRequestChime).toHaveBeenCalledOnce();
  });

  it("starts muted when this browser turned the chime off", async () => {
    window.localStorage.setItem(MUTE_KEY, "1");
    renderChip([request("jr1", "kim kim")]);
    await screen.findByTestId(PANEL);
    expect(playJoinRequestChime).not.toHaveBeenCalled();
  });

  it("moves focus to the stage heading when the last person is let in", async () => {
    const { update } = renderChip([request("jr1", "kim kim")]);
    const admit = await screen.findByRole("button", { name: "Cho kim kim vào" });
    act(() => admit.focus());

    await update([]);
    await waitFor(() => expect(screen.queryByTestId(PANEL)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Standup" })).toHaveFocus());
  });
});
