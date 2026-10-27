import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingFeedEntry } from "@uniwork/core/meetings/feed";
import type { MeetingNote } from "@uniwork/core/types/meeting";
import { requestMock, wrap } from "../../test/api-mock";
import { MeetingFeedList } from "./feed-list";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

beforeAll(() => {
  initI18n();
});

const user = (id: string) => ({
  id,
  email: `${id}@x.co`,
  display_name: id,
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  timezone: "Asia/Ho_Chi_Minh",
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
  toastError.mockReset();
  setSessionUser(user("u-tuan"));
});
afterEach(() => {
  resetAuthStoreForTests();
});

const noteEntry = (over: Partial<MeetingNote> = {}): MeetingFeedEntry => {
  const note: MeetingNote = { id: "n1", meeting_id: "m1", author_id: "u-tuan", body: "Mời đại diện Q7", display_name: "Tuấn Đỗ", ...over };
  return { id: `note:${note.id}`, kind: "note", text: note.body, at: null, segmentId: null, note };
};

function setup(entries: MeetingFeedEntry[] = [noteEntry()], canClerk = false) {
  render(
    wrap(
      <MeetingFeedList
        entries={entries}
        unseen={new Set()}
        canClerk={canClerk}
        workspaceId="w1"
        meetingId="m1"
        onJumpToSegment={vi.fn()}
        onEditItem={vi.fn()}
      />,
    ),
  );
  return within(screen.getByRole("list", { name: "Diễn biến cuộc họp" }));
}

const actions = (text = "Mời đại diện Q7") => screen.queryByRole("button", { name: `Thao tác với ghi chú: ${text}` });
// Opens the note's ⋯ menu and picks an item.
async function pick(item: "Sửa" | "Xóa ghi chú") {
  fireEvent.click(actions()!);
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}
const calls = (method: string) =>
  requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === method);

describe("MeetingFeedList › a note's edit and delete (UNI-2217)", () => {
  it("offers the author one ⋯ menu with edit and delete, and no pencil button", async () => {
    setup();
    expect(screen.queryByRole("button", { name: /Sửa/ })).toBeNull();
    fireEvent.click(actions()!);
    expect(await screen.findByRole("menuitem", { name: "Sửa" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Xóa ghi chú" })).toBeInTheDocument();
  });

  it("offers no ⋯ menu to a member who neither wrote the note nor clerks", () => {
    setSessionUser(user("u-other"));
    setup();
    expect(actions()).toBeNull();
  });

  it("offers a clerk the ⋯ menu on someone else's note", () => {
    setSessionUser(user("u-host"));
    setup([noteEntry()], true);
    expect(actions()).toBeInTheDocument();
  });

  it("saves the trimmed text with PATCH on Enter and gives focus back to the ⋯", async () => {
    setup();
    await pick("Sửa");
    const field = screen.getByRole("textbox", { name: "Nội dung ghi chú" });
    expect(field).toHaveValue("Mời đại diện Q7");
    fireEvent.change(field, { target: { value: "  Mời đại diện Q7 và Q8 \n" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0]).toEqual(["/api/v1/meetings/m1/notes/n1", { method: "PATCH", body: { body: "Mời đại diện Q7 và Q8" } }]);
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    await waitFor(() => expect(actions()).toHaveFocus());
  });

  it("keeps a new line on Shift+Enter, and will not save an empty note", async () => {
    setup();
    await pick("Sửa");
    const field = screen.getByRole("textbox", { name: "Nội dung ghi chú" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    const save = screen.getByRole("button", { name: "Lưu" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(calls("PATCH")).toHaveLength(0);
    expect(field).toBeInTheDocument();
  });

  it("cancels on Esc without a request and gives focus back to the ⋯", async () => {
    setup();
    await pick("Sửa");
    const field = screen.getByRole("textbox", { name: "Nội dung ghi chú" });
    fireEvent.change(field, { target: { value: "khác" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Mời đại diện Q7")).toBeInTheDocument();
    await waitFor(() => expect(actions()).toHaveFocus());
    expect(requestMock.mock.calls.filter(([path]) => String(path).includes("/notes"))).toHaveLength(0);
  });

  it("keeps the editor and its text open when the save fails", async () => {
    requestMock.mockImplementation((_path: unknown, init?: { method?: string }) =>
      init?.method === "PATCH" ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    setup();
    await pick("Sửa");
    const field = screen.getByRole("textbox", { name: "Nội dung ghi chú" });
    fireEvent.change(field, { target: { value: "Bản mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Nội dung ghi chú" })).toHaveValue("Bản mới");
  });

  it("asks before deleting, then sends DELETE and moves focus to the next note's ⋯", async () => {
    const list = setup([noteEntry(), noteEntry({ id: "n2", body: "Thứ hai" })]);
    await pick("Xóa ghi chú");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Xóa ghi chú này?");
    expect(dialog).toHaveTextContent("Mọi người trong cuộc họp sẽ không thấy ghi chú này nữa.");
    expect(calls("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(calls("DELETE")).toEqual([["/api/v1/meetings/m1/notes/n1", { method: "DELETE" }]]));
    await waitFor(() => expect(list.getByRole("button", { name: "Thao tác với ghi chú: Thứ hai" })).toHaveFocus());
  });

  it("marks an edited note after its author", () => {
    const list = setup([noteEntry({ edited_at: "2026-10-27T03:00:00Z" }), noteEntry({ id: "n2", body: "Chưa sửa" })]);
    const [edited, untouched] = list.getAllByRole("listitem");
    expect(edited).toHaveTextContent(/Tuấn Đỗ\s*· đã sửa/);
    expect(untouched).not.toHaveTextContent("đã sửa");
  });
});
