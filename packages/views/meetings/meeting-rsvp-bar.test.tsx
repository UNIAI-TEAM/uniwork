import { render, screen } from "@testing-library/react";
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

  it("shows the saved RSVP badge after responding", () => {
    const { rerender } = render(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{
            id: "inv1",
            meeting_id: "m1",
            participant_id: "p1",
            response_status: "ACCEPTED",
          }}
        />,
      ),
    );

    expect(screen.getByText("Nhận lời")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Từ chối" })).not.toBeInTheDocument();

    rerender(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{
            id: "inv1",
            meeting_id: "m1",
            participant_id: "p1",
            response_status: "TENTATIVE",
          }}
        />,
      ),
    );
    expect(screen.getByText("Chưa chắc")).toBeInTheDocument();

    rerender(
      wrapWithNav(
        <MeetingRsvpBar
          meetingId="m1"
          invitation={{
            id: "inv1",
            meeting_id: "m1",
            participant_id: "p1",
            response_status: "DECLINED",
          }}
        />,
      ),
    );
    expect(screen.getByText("Từ chối")).toBeInTheDocument();
  });
});
