import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingNotesSection } from "./meeting-notes-section";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

function notesRespond(notes: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/notes") ? notes() : Promise.resolve({}),
  );
}

const EMPTY = /Chưa có ghi chú/;

describe("MeetingNotesSection", () => {
  it("shows a loading skeleton, not the empty copy, while notes load", () => {
    notesRespond(() => new Promise(() => {}));
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    notesRespond(() => Promise.resolve({ notes: [] }));
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when notes fail", async () => {
    notesRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    expect(await screen.findByText("Không tải được ghi chú.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    notesRespond(() => Promise.resolve({ notes: [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "Chốt lịch" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chốt lịch")).toBeInTheDocument();
  });
});
