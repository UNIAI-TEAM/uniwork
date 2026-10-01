import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingVotePrompt } from "./meeting-vote-prompt";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TITLE = "Thông qua kế hoạch quý IV";
const BALLOT = "/api/v1/meetings/m1/motions/mo1/ballot";
const open = {
  id: "mo1", title: TITLE, description: "", position: 1,
  ballot_mode: "SECRET", threshold: "MAJORITY", base: "PRESENT", status: "OPEN",
  opened_at: "2026-10-01T02:10:00Z", roll_size: 3, total_members: 4, cast_count: 0,
  result: null, voters: null, my_ballot: { on_roll: true, cast: false, choice: null },
};
let motions: unknown[] = [];

function renderPrompt(onOpenTab = vi.fn()) {
  render(
    <>
      <button type="button">Bật mic</button>
      {wrapWithNav(<MeetingVotePrompt meetingId="m1" onOpenTab={onOpenTab} />)}
    </>,
  );
  return onOpenTab;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  motions = [open];
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p === BALLOT) {
      // The server now reports the ballot as cast; the card must not come back.
      motions = [{ ...open, cast_count: 1, my_ballot: { on_roll: true, cast: true, choice: null } }];
      return Promise.resolve({ status: "ok" });
    }
    return Promise.resolve(p.endsWith("/motions") ? { motions } : {});
  });
});

describe("MeetingVotePrompt", () => {
  it("appears as a named live region without taking focus", async () => {
    renderPrompt();
    const mic = screen.getByRole("button", { name: "Bật mic" });
    mic.focus();
    const region = await screen.findByRole("region", { name: "Mời bỏ phiếu" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(within(region).getByRole("radiogroup", { name: `Phiếu của bạn cho “${TITLE}”` })).toBeInTheDocument();
    expect(document.activeElement).toBe(mic);
  });

  it("sends the ballot and confirms it in place", async () => {
    renderPrompt();
    const region = await screen.findByRole("region", { name: "Mời bỏ phiếu" });
    fireEvent.click(within(region).getByRole("radio", { name: "Tán thành" }));
    fireEvent.click(within(region).getByRole("button", { name: "Gửi phiếu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        BALLOT,
        expect.objectContaining({ method: "POST", body: { choice: "YES" } }),
      ),
    );
    expect(await within(region).findByText("Đã ghi nhận phiếu")).toBeInTheDocument();
    expect(within(region).queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("opens the votes tab and hides on request", async () => {
    const onOpenTab = renderPrompt();
    const region = await screen.findByRole("region", { name: "Mời bỏ phiếu" });
    fireEvent.click(within(region).getByRole("button", { name: "Mở tab Biểu quyết" }));
    expect(onOpenTab).toHaveBeenCalledTimes(1);
    fireEvent.click(within(region).getByRole("button", { name: "Ẩn" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Mời bỏ phiếu" })).not.toBeInTheDocument());
    expect(requestMock).not.toHaveBeenCalledWith(BALLOT, expect.anything());
  });

  it("hides on Escape", async () => {
    renderPrompt();
    const region = await screen.findByRole("region", { name: "Mời bỏ phiếu" });
    fireEvent.keyDown(within(region).getByRole("button", { name: "Ẩn" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Mời bỏ phiếu" })).not.toBeInTheDocument());
  });

  it("renders nothing while no vote is waiting", async () => {
    motions = [];
    renderPrompt();
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meetings/m1/motions"))).toBe(true),
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
