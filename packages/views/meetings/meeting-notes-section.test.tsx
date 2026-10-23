import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("sends on Enter, keeps Shift+Enter for a new line, and says when each note was written", async () => {
    const created = new Date(Date.now() - 5 * 60_000).toISOString();
    requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
      if (String(path).endsWith("/notes") && opts?.method === "POST") return Promise.resolve({ note: {} });
      if (String(path).endsWith("/notes")) {
        return Promise.resolve({ notes: [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "Chốt lịch", created_at: created }] });
      }
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    expect(await screen.findByText("5 phút trước")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Thêm ghi chú" });
    expect(box.tagName).toBe("TEXTAREA");
    expect(screen.getByRole("button", { name: "Thêm" })).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "Dòng một" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/notes", expect.objectContaining({ method: "POST" }));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/notes", expect.objectContaining({ method: "POST" })),
    );
  });

  it("on touch, Enter breaks the line and only the button adds the note", async () => {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
      query === "(pointer: coarse)" ? ({ ...real(query), matches: true } as MediaQueryList) : real(query),
    );
    requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
      if (String(path).endsWith("/notes") && opts?.method === "POST") return Promise.resolve({ note: {} });
      if (String(path).endsWith("/notes")) return Promise.resolve({ notes: [] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    const box = await screen.findByRole("textbox", { name: "Thêm ghi chú" });
    await waitFor(() => expect(box).not.toHaveAttribute("aria-describedby"));
    fireEvent.change(box, { target: { value: "Dòng một" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/meetings/m1/notes", expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/notes", expect.objectContaining({ method: "POST" })),
    );
  });

  it("does not print a raw user id when the author is unknown", async () => {
    notesRespond(() => Promise.resolve({ notes: [{ id: "n1", meeting_id: "m1", author_id: "01J8X4K2M0N1", body: "Chốt lịch" }] }));
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" />));

    expect(await screen.findByText("Thành viên đã rời")).toBeInTheDocument();
    expect(screen.queryByText("01J8X4K2M0N1")).not.toBeInTheDocument();
  });

  it("closes the composer once the meeting is over", async () => {
    notesRespond(() => Promise.resolve({ notes: [] }));
    render(wrapWithNav(<MeetingNotesSection meetingId="m1" locked />));

    expect(await screen.findByText("Cuộc họp không có ghi chú nào.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm" })).not.toBeInTheDocument();
  });
});
