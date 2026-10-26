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

  it("folds the waiting guests into one card with admit all", async () => {
    render(wrapWithNav(<MeetingJoinRequestsSection meetingId="m1" />));

    expect(await screen.findByRole("region", { name: "2 người đang chờ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cho vào" })).toBeInTheDocument();
    expect(screen.queryByText("Guest One")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem từng người" }));
    expect(await screen.findByText("Guest One")).toBeInTheDocument();
    expect(screen.getByText("Guest Two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem từng người" })).toHaveAttribute("aria-expanded", "true");
  });

  it("approves a single guest from the people tab row", async () => {
    render(wrapWithNav(<MeetingJoinRequestsSection meetingId="m1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Xem từng người" }));

    fireEvent.click(await screen.findByRole("button", { name: "Cho Guest One vào" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Xem từng người" }));

    fireEvent.click(await screen.findByRole("button", { name: "Cho Guest One vào" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cho Guest One vào" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cho Guest Two vào" })).toBeEnabled();
  });
});
