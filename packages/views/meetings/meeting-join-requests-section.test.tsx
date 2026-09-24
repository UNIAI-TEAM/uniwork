import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingJoinRequestsSection } from "./meeting-join-requests-section";

beforeAll(() => {
  initI18n();
});

describe("MeetingJoinRequestsSection", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({
      join_requests: [
        {
          id: "jr1",
          meeting_id: "m1",
          status: "PENDING",
          display_name_snapshot: "Guest One",
        },
        {
          id: "jr2",
          meeting_id: "m1",
          status: "PENDING",
          display_name_snapshot: "Guest Two",
        },
      ],
    });
  });

  it("lists waiting guests with admit all for hosts", async () => {
    render(wrapWithNav(<MeetingJoinRequestsSection meetingId="m1" />));

    expect(await screen.findByText("Đang chờ được duyệt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duyệt tất cả" })).toBeInTheDocument();
    expect(screen.getByText("Guest One")).toBeInTheDocument();
    expect(screen.getByText("Guest Two")).toBeInTheDocument();
  });

  it("approves a single guest from the people tab row", async () => {
    render(wrapWithNav(<MeetingJoinRequestsSection meetingId="m1" />));

    fireEvent.click(await screen.findByRole("button", { name: "Duyệt Guest One" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/meeting-join-requests/jr1/approve"),
        expect.any(Object),
      );
    });
  });

  it("holds only the row being approved, not every row", async () => {
    requestMock.mockImplementation((path: string) =>
      path.includes("/approve") ? new Promise(() => {}) : Promise.resolve({
        join_requests: [
          { id: "jr1", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Guest One" },
          { id: "jr2", meeting_id: "m1", status: "PENDING", display_name_snapshot: "Guest Two" },
        ],
      }),
    );
    render(wrapWithNav(<MeetingJoinRequestsSection meetingId="m1" />));

    fireEvent.click(await screen.findByRole("button", { name: "Duyệt Guest One" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Duyệt Guest One" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Duyệt Guest Two" })).toBeEnabled();
  });
});
