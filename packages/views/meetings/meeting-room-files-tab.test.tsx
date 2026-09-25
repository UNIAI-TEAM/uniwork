import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomFilesTab } from "./meeting-room-files-tab";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

function recordingsRespond(recordings: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/recordings") ? recordings() : Promise.resolve({}),
  );
}

const EMPTY = /Chưa có bản ghi/;

describe("MeetingRoomFilesTab", () => {
  it("shows a loading skeleton, not the empty copy, while files load", () => {
    recordingsRespond(() => new Promise(() => {}));
    render(wrapWithNav(<MeetingRoomFilesTab meetingId="m1" />));

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    recordingsRespond(() => Promise.resolve({ recordings: [] }));
    render(wrapWithNav(<MeetingRoomFilesTab meetingId="m1" />));

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when files fail", async () => {
    recordingsRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingRoomFilesTab meetingId="m1" />));

    expect(await screen.findByText("Không tải được bản ghi của cuộc họp.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    recordingsRespond(() => Promise.resolve({ recordings: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });
});
