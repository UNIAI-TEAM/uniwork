import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatPollMessageRow } from "./chat-poll-message-row";

const vote = vi.fn();
vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useVoteChatPollMessage: () => ({ mutateAsync: vote, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

beforeAll(() => {
  initI18n();
});

function poll(allowMultiple: boolean) {
  return {
    question: "Ăn trưa ở đâu?",
    options: [
      { id: "o1", label: "Phở", votes: 2 },
      { id: "o2", label: "Cơm", votes: 1 },
    ],
    settings: {
      deadline_at: null,
      pin_to_top: false,
      allow_multiple: allowMultiple,
      allow_add_options: false,
      hide_results_until_vote: false,
      hide_voters: false,
    },
    viewer_option_ids: ["o1"],
    votes_by_user: { u1: ["o1"], u2: ["o1"], u3: ["o2"] },
  };
}

function renderPoll(allowMultiple: boolean) {
  return render(
    wrap(
      <ChatPollMessageRow
        messageId="p1"
        workspaceId="ws1"
        roomId="r1"
        poll={poll(allowMultiple)}
        senderLabel="Bạn"
        senderId="u1"
        isOwn
        ts={Date.parse("2026-09-01T05:00:00Z")}
        nameContext={[]}
        currentUserId="u1"
        youLabel="Bạn"
      />,
    ),
  );
}

describe("ChatPollMessageRow", () => {
  it("is a radio group for one choice and says who made it, even in a DM", () => {
    renderPoll(false);
    const group = screen.getByRole("radiogroup", { name: "Ăn trưa ở đâu?" });
    expect(group).toHaveAccessibleDescription("Chọn một");
    expect(screen.getByRole("radio", { name: /Phở/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("article")).toHaveAccessibleName(/^Bình chọn của Bạn/);
    expect(screen.getByRole("button", { name: "Xem 2 người chọn Phở" })).toBeInTheDocument();
  });

  it("is a set of checkboxes for many choices, and a failed vote is said out loud", async () => {
    vote.mockRejectedValueOnce(new TypeError("offline"));
    renderPoll(true);
    expect(screen.getByRole("group", { name: "Ăn trưa ở đâu?" })).toHaveAccessibleDescription("Chọn nhiều");
    await userEvent.click(screen.getByRole("checkbox", { name: /Cơm/ }));
    expect(vote).toHaveBeenCalledWith({ roomId: "r1", messageId: "p1", optionId: "o2" });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
