import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatPollVoteActivityRow } from "./chat-poll-vote-activity-row";

beforeAll(() => {
  initI18n();
});

describe("ChatPollVoteActivityRow", () => {
  it("shows who joined the poll and jumps on View", async () => {
    const user = userEvent.setup();
    const onViewPoll = vi.fn();
    render(
      wrap(
        <ChatPollVoteActivityRow senderLabel="Minh Trường" question="Ăn trưa?" onViewPoll={onViewPoll} />,
      ),
    );
    expect(screen.getByText(/Minh Trường/)).toBeInTheDocument();
    expect(screen.getByText(/Ăn trưa\?/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Xem" }));
    expect(onViewPoll).toHaveBeenCalledTimes(1);
  });
});
