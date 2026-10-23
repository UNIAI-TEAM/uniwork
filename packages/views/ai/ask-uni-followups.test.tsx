import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AskUniFollowups } from "./ask-uni-followups";

initI18n();

describe("AskUniFollowups", () => {
  it("renders one button per question and sends the clicked one", () => {
    const onAsk = vi.fn();
    render(<ul><AskUniFollowups items={["A?", "B?"]} onAsk={onAsk} /></ul>);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "A?" }));
    expect(onAsk).toHaveBeenCalledWith("A?");
  });

  it("labels the group and renders nothing for an empty list", () => {
    const { container, rerender } = render(<ul><AskUniFollowups items={["A?"]} onAsk={vi.fn()} /></ul>);
    expect(screen.getByText("Gợi ý hỏi tiếp")).toBeInTheDocument();
    rerender(<ul><AskUniFollowups items={[]} onAsk={vi.fn()} /></ul>);
    expect(container.querySelector("li")).toBeNull();
  });
});
