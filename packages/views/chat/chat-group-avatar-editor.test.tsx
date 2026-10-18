import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrap } from "../test/api-mock";
import { ChatGroupAvatarEditor } from "./chat-group-avatar-editor";
import { ChatRoomMark } from "./chat-room-mark";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

afterEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
});

const png = (bytes = 10) => new File([new Uint8Array(bytes)], "nhom.png", { type: "image/png" });

function renderEditor(props: Partial<{ imageUrl: string; canEdit: boolean }> = {}) {
  const { container } = render(
    wrap(<ChatGroupAvatarEditor workspaceId="ws1" roomId="g1" tint="violet" canEdit {...props} />),
  );
  return container.querySelector<HTMLInputElement>('input[type="file"]');
}

describe("ChatRoomMark photo", () => {
  it("draws a group's photo, and the glyph tile again when the photo fails to load", () => {
    const { container } = render(<ChatRoomMark icon={Users} size="list" imageUrl="https://s.test/g.png" />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://s.test/g.png");
    // Decorative: the room's name sits beside it.
    expect(img).toHaveAttribute("alt", "");
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("is the glyph tile without a photo", () => {
    const { container } = render(<ChatRoomMark icon={Users} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("ChatGroupAvatarEditor", () => {
  it("offers no camera to a member who may not rename the group", () => {
    renderEditor({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Đổi ảnh nhóm" })).toBeNull();
  });

  it("uploads the picked photo", async () => {
    requestMock.mockResolvedValue({ room: { id: "g1", kind: "group", name: "G", workspace_id: "ws1" } });
    const input = renderEditor();
    expect(screen.getByRole("button", { name: "Đổi ảnh nhóm" })).toBeInTheDocument();
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/gif,image/webp");
    const file = png();
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const [path, init] = requestMock.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe("/api/v1/workspaces/ws1/chat/rooms/g1/avatar");
    expect(init.method).toBe("POST");
    expect(init.body.get("file")).toBe(file);
  });

  it("refuses a file over 2 MiB or of another type before sending it", () => {
    const input = renderEditor();
    fireEvent.change(input!, { target: { files: [png(2 * 1024 * 1024 + 1)] } });
    expect(toast.error).toHaveBeenLastCalledWith("Ảnh lớn hơn 2 MB. Chọn ảnh nhỏ hơn.");
    fireEvent.change(input!, { target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] } });
    expect(toast.error).toHaveBeenLastCalledWith("Ảnh phải là PNG, JPEG, GIF hoặc WebP.");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("says the server's 413 in chat's words", async () => {
    requestMock.mockRejectedValue(new ApiError("avatar must be at most 2097152 bytes", "too_large", 413));
    const input = renderEditor();
    fireEvent.change(input!, { target: { files: [png()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ảnh lớn hơn 2 MB. Chọn ảnh nhỏ hơn."));
  });

  it("removes the photo from the camera's menu once the group has one", async () => {
    requestMock.mockResolvedValue({ room: { id: "g1", kind: "group", name: "G", workspace_id: "ws1" } });
    const user = userEvent.setup();
    renderEditor({ imageUrl: "https://s.test/g.png" });
    await user.click(screen.getByRole("button", { name: "Đổi ảnh nhóm" }));
    await user.click(await screen.findByRole("menuitem", { name: "Gỡ ảnh nhóm" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/chat/rooms/g1/avatar", { method: "DELETE" }),
    );
  });
});
