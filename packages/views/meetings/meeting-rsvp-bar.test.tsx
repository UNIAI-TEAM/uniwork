import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRsvpBar } from "./meeting-rsvp-bar";

beforeAll(() => {
  initI18n();
});

describe("MeetingRsvpBar", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it("shows response buttons while the invitation is pending", () => {
    render(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{
            id: "inv1",
            meeting_id: "m1",
            participant_id: "p1",
            response_status: "PENDING",
          }}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Tham dự" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chưa chắc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
  });

  it("keeps all three answers on screen and marks the saved one", () => {
    render(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{ id: "inv1", meeting_id: "m1", participant_id: "p1", response_status: "ACCEPTED" }}
        />,
      ),
    );

    const accept = screen.getByRole("button", { name: "Tham dự" });
    expect(accept).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Chưa chắc" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Từ chối" })).toHaveAttribute("aria-pressed", "false");
    // The answer is a quiet wash, never a second filled brand button next to "Vào phòng họp".
    expect(accept.className).toMatch(/bg-brand-subtle/);
    expect(accept.className).not.toMatch(/(^|\s)bg-brand(\s|$)/);
  });

  it("sends a changed answer straight from the control", async () => {
    render(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{ id: "inv1", meeting_id: "m1", participant_id: "p1", response_status: "ACCEPTED" }}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/invitations/inv1"),
        expect.objectContaining({ method: expect.any(String) }),
      ),
    );
  });

  it("marks nothing while the invitation is still pending", () => {
    render(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{ id: "inv1", meeting_id: "m1", participant_id: "p1", response_status: "PENDING" }}
        />,
      ),
    );
    for (const name of ["Tham dự", "Chưa chắc", "Từ chối"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button.className).not.toMatch(/(^|\s)bg-brand(\s|$)/);
    }
  });
});
