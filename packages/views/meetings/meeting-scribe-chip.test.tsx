import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock } from "../test/api-mock";
import { MeetingScribeChip, scribeChipState } from "./meeting-scribe-chip";

const lk = vi.hoisted(() => ({ remote: [] as { identity: string; isAgent?: boolean }[] }));
vi.mock("@livekit/components-react", () => ({ useRemoteParticipants: () => lk.remote }));

const meeting = {
  id: "m1", workspace_id: "w1", title: "Giao ban", description: "", starts_at: "2026-10-20T02:00:00Z",
  ends_at: "2026-10-20T03:00:00Z", room_name: "uw_mtg_m1", created_by: "u1", status: "IN_PROGRESS",
  scribe_enabled: true,
} satisfies Meeting;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  lk.remote = [];
  requestMock.mockReset();
});

describe("scribeChipState", () => {
  it("prefers the agent in the room, then the switch, then the run status", () => {
    expect(scribeChipState({ scribe_enabled: true }, true)).toBe("on");
    expect(scribeChipState({ scribe_enabled: false }, true)).toBe("off");
    expect(scribeChipState({ scribe_enabled: true, scribe_status: "FAILED" }, false)).toBe("failed");
    expect(scribeChipState({}, false)).toBe("joining");
  });
});

describe("MeetingScribeChip", () => {
  it("shows everyone that the AI is transcribing, without a switch for a non-host", async () => {
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true }];
    render(wrap(<MeetingScribeChip meeting={meeting} available canSwitch={false} />));
    await userEvent.click(screen.getByTestId("meeting-scribe-chip"));
    expect(await screen.findByText(/Thư ký AI nghe từng người/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tắt Thư ký AI" })).not.toBeInTheDocument();
  });

  it("is hidden where the workspace has no scribe and none is in the room", () => {
    render(wrap(<MeetingScribeChip meeting={meeting} available={false} canSwitch />));
    expect(screen.queryByTestId("meeting-scribe-chip")).not.toBeInTheDocument();
  });

  it("is hidden from a non-host while the scribe is off or still joining", () => {
    render(wrap(<MeetingScribeChip meeting={{ ...meeting, scribe_enabled: false }} available canSwitch={false} />));
    expect(screen.queryByTestId("meeting-scribe-chip")).not.toBeInTheDocument();
  });

  it("lets the host switch it off", async () => {
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true }];
    requestMock.mockResolvedValue({ meeting: { ...meeting, scribe_enabled: false } });
    render(wrap(<MeetingScribeChip meeting={meeting} available canSwitch />));
    await userEvent.click(screen.getByTestId("meeting-scribe-chip"));
    await userEvent.click(await screen.findByRole("button", { name: "Tắt Thư ký AI" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/scribe", { method: "PUT", body: { enabled: false } }),
    );
  });

  it("names the scribe on the chip, so a phone still reads who is listening", () => {
    lk.remote = [{ identity: "uw_agent_scribe", isAgent: true }];
    render(wrap(<MeetingScribeChip meeting={meeting} available canSwitch={false} />));
    const chip = screen.getByTestId("meeting-scribe-chip");
    expect(chip).toHaveAccessibleName("Thư ký AI đang ghi lời");
  });

  it("says it failed, in the room's dark palette, and lets the host try again", async () => {
    requestMock.mockResolvedValue({ meeting });
    render(wrap(<MeetingScribeChip meeting={{ ...meeting, scribe_status: "FAILED" }} available canSwitch />));
    await userEvent.click(screen.getByTestId("meeting-scribe-chip"));
    const failed = await screen.findByText(/nên chưa ghi lời thoại/);
    expect(failed.closest("[data-slot=popover-content]")).toHaveClass("dark");
    expect(screen.queryByText(/nghe từng người/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/scribe", { method: "PUT", body: { enabled: true } }),
    );
  });

  it("sets a failed scribe apart: warning tone and its own short label, never the listening one", () => {
    render(wrap(<MeetingScribeChip meeting={{ ...meeting, scribe_status: "FAILED" }} available canSwitch />));
    const chip = screen.getByTestId("meeting-scribe-chip");
    expect(chip.className).toMatch(/\btext-warning\b/);
    expect(chip).toHaveTextContent("Chưa ghi lời");
    expect(chip).not.toHaveTextContent(/^Thư ký AI$/);
    expect(chip).toHaveAccessibleName(/Thư ký AI chưa vào được phòng/);
  });

  it("explains a scribe still joining as joining, not as listening", async () => {
    render(wrap(<MeetingScribeChip meeting={meeting} available canSwitch />));
    await userEvent.click(screen.getByTestId("meeting-scribe-chip"));
    expect(await screen.findByText(/đang vào phòng\. Khi vào xong/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });
});
