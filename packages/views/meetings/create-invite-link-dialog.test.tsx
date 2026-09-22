import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { CreateInviteLinkDialog } from "./create-invite-link-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  requestMock.mockReset();
});

function renderDialog() {
  render(wrapWithNav(<CreateInviteLinkDialog meetingId="m1" open onOpenChange={() => {}} />));
  return screen.getByRole("dialog");
}

describe("CreateInviteLinkDialog", () => {
  it("shows what the link does and how guests get in as text", () => {
    const dialog = renderDialog();
    const description = within(dialog).getByText(/Tạo liên kết để khách bên ngoài/);
    expect(description).not.toHaveClass("sr-only");
    expect(within(dialog).getByText("Khách vào phòng ngay khi cuộc họp đã bắt đầu.")).toBeInTheDocument();
  });

  it("names both selects through their visible labels", () => {
    const dialog = renderDialog();
    expect(within(dialog).getByRole("combobox", { name: "Hạn dùng" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Quyền vào phòng của khách" })).toBeInTheDocument();
  });

  it("shows the pending label while creating", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo liên kết" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang tạo…" })).toBeDisabled());
  });

  it("offers a labelled copy button once the link exists", async () => {
    requestMock.mockResolvedValue({
      invite_link: {
        id: "l1",
        meeting_id: "m1",
        name: "Link",
        access_mode: "AUTO_ADMIT",
        expires_at: "2030-01-01T00:00:00Z",
        used_count: 0,
        secret: "s3cret",
      },
    });
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo liên kết" }));
    expect(await within(dialog).findByRole("button", { name: "Sao chép" })).toBeInTheDocument();
    expect(within(dialog).getByText(/#secret=s3cret/)).toBeInTheDocument();
  });
});
