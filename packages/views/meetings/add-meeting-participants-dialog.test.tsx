import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const members = [
  { workspace_id: "w1", user_id: "u-a", role: "member", email: "a@x.com", display_name: "An" },
  { workspace_id: "w1", user_id: "u-b", role: "member", email: "b@x.com", display_name: "Bình" },
];

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

function renderDialog() {
  render(
    wrapWithNav(
      <AddMeetingParticipantsDialog workspaceId="w1" meetingId="m1" excludeUserIds={[]} open onOpenChange={() => {}} />,
    ),
  );
  return screen.getByRole("dialog");
}

describe("AddMeetingParticipantsDialog", () => {
  it("says why Invite waits until someone is picked", async () => {
    requestMock.mockResolvedValue({ members });
    const dialog = renderDialog();
    expect(within(dialog).getByRole("button", { name: "Mời thành viên" })).toBeDisabled();
    expect(within(dialog).getByText("Chọn ít nhất một người để mời")).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByText("An"));
    expect(within(dialog).getByRole("button", { name: "Mời thành viên" })).toBeEnabled();
  });

  it("shows the pending label while inviting", async () => {
    requestMock.mockImplementation((_p: unknown, init?: { method?: string }) =>
      init?.method === "POST" ? new Promise(() => {}) : Promise.resolve({ members }),
    );
    const dialog = renderDialog();
    fireEvent.click(await within(dialog).findByText("An"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang mời…" })).toBeDisabled());
  });

  it("keeps only the people who failed, names them, and refreshes the roster at once", async () => {
    requestMock.mockImplementation((_p: unknown, init?: { method?: string; body?: { user_id?: string } }) => {
      if (init?.method === "POST") {
        return init.body?.user_id === "u-b"
          ? Promise.reject(new ApiError("không mời được", "forbidden", 403))
          : Promise.resolve({ participant: null });
      }
      return Promise.resolve({ members });
    });
    const onOpenChange = vi.fn();
    render(
      wrapWithNav(
        <AddMeetingParticipantsDialog workspaceId="w1" meetingId="m1" excludeUserIds={[]} open onOpenChange={onOpenChange} />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(await within(dialog).findByText("An"));
    fireEvent.click(within(dialog).getByText("Bình"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Mời thành viên" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Chưa mời được: Bình. Thử lại.");
    expect(toast.success).toHaveBeenCalledWith("Đã mời 1 thành viên");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Retrying sends only the one who failed.
    requestMock.mockClear();
    requestMock.mockImplementation((_p: unknown, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.resolve({ participant: null }) : Promise.resolve({ members }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const posts = requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect((posts[0]![1] as { body: { user_id: string } }).body.user_id).toBe("u-b");
  });
});
