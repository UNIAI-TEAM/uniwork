import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { requestMock, wrap } from "../test/api-mock";
import { ChatForwardDialog } from "./chat-forward-dialog";
import { isForwardableChatMessage } from "./chat-forward-context";
import { ChatForwardedLabel } from "./chat-forwarded-label";
import type { ChatMessage } from "./chat-messages";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const message: ChatMessage = { id: "m1", sender: "u2", body: "Báo giá mới nhé", kind: "text", ts: 0, reactions: {} };

const rooms = [
  { id: "r-dm", kind: "dm", name: "", workspace_id: "ws1", peer_user_id: "u3", peer_display_name: "Võ Minh", peer_email: "minh@x.vn", last_message_at: "2026-10-18T09:00:00Z" },
  { id: "r-group", kind: "group", name: "Đội Thiết kế", workspace_id: "ws1", member_user_ids: ["u2", "u3"], last_message_at: "2026-10-18T10:00:00Z" },
];

function renderDialog(onOpenChange = vi.fn()) {
  return render(wrap(<ChatForwardDialog workspaceId="ws1" message={message} onOpenChange={onOpenChange} />));
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("ChatForwardDialog", () => {
  it("sends to the picked rooms with the note and names them", async () => {
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === "POST"
          ? { messages: [{ room_id: "r-group", message_id: "c1" }, { room_id: "r-dm", message_id: "c2" }] }
          : { rooms },
      ),
    );
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    // Newest conversation first.
    const rows = await screen.findAllByRole("checkbox");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Đội Thiết kế"),
      expect.stringContaining("Võ Minh"),
    ]);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    fireEvent.change(screen.getByLabelText("Lời nhắn kèm theo"), { target: { value: " Xem giúp " } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tới 2 cuộc trò chuyện" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã chuyển tiếp tới Đội Thiết kế, Võ Minh"));
    const post = requestMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === "POST");
    expect(post?.[0]).toBe("/api/v1/workspaces/ws1/chat/messages/m1/forward");
    expect((post?.[1] as { body: unknown }).body).toEqual({ target_room_ids: ["r-group", "r-dm"], comment: "Xem giúp" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the room that refused, since nothing was sent", async () => {
    requestMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? Promise.reject(new ApiError("refused", "chat_forward_target_refused", 403, undefined, { room_id: "r-dm" }))
        : Promise.resolve({ rooms }),
    );
    renderDialog();
    fireEvent.click((await screen.findAllByRole("checkbox"))[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Gửi tới 1 cuộc trò chuyện" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Không gửi được vào Võ Minh, nên chưa cuộc trò chuyện nào nhận tin."),
    );
  });
});

describe("forwarding helpers", () => {
  it("offers forwarding only for the kinds the server copies", () => {
    expect(isForwardableChatMessage(message)).toBe(true);
    expect(isForwardableChatMessage({ ...message, kind: "poll" })).toBe(false);
    expect(isForwardableChatMessage({ ...message, kind: "voice_call_log" })).toBe(false);
    expect(isForwardableChatMessage({ ...message, deliveryStatus: "sending" })).toBe(false);
    expect(isForwardableChatMessage({ ...message, kind: "file" })).toBe(false);
  });

  it("labels a forwarded copy with the original author", () => {
    render(wrap(<ChatForwardedLabel message={{ ...message, forwardedFrom: { senderId: "u9", senderName: "Nguyễn Thu Hà" } }} isOwn={false} />));
    expect(screen.getByText("Chuyển tiếp từ Nguyễn Thu Hà")).toBeInTheDocument();
  });
});
