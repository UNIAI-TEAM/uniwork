import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPollVotersDialog } from "./chat-poll-voters-dialog";

const props = {
  open: true,
  onOpenChange: vi.fn(),
  question: "Ăn trưa ở đâu?",
  options: [
    { id: "o1", label: "Phở", votes: 3 },
    { id: "o2", label: "Bún chả", votes: 1 },
  ],
  votesByUser: { U1: ["o1"], U2: ["o1"], U3: ["o1"], U4: ["o2"] },
  nameContext: [
    { user_id: "U1", display_name: "Lan" },
    { user_id: "U2", display_name: "Minh" },
    { user_id: "U3", display_name: "Hà" },
    { user_id: "U4", display_name: "Tú" },
  ],
  currentUserId: "U1",
  youLabel: "Bạn",
};

describe("ChatPollVotersDialog", () => {
  it("shows each option's share as a progress bar with its voters", () => {
    render(<ChatPollVotersDialog {...props} />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "75");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Tú")).toBeInTheDocument();
  });

  it("lists only the focused option's voters, with no bars", () => {
    render(<ChatPollVotersDialog {...props} focusedOptionId="o2" />);
    expect(screen.getByRole("heading", { name: "Bún chả" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Tú")).toBeInTheDocument();
    expect(screen.queryByText("Minh")).toBeNull();
  });
});
