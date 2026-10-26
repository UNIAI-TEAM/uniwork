import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { wrap } from "../../test/api-mock";
import { ComposerSuggestions, useMeetingSuggestions } from "./composer-suggestions";

function suggestions(hasItems: boolean) {
  return renderHook(() => useMeetingSuggestions(hasItems), { wrapper: ({ children }) => wrap(<>{children}</>) }).result.current;
}

describe("ComposerSuggestions", () => {
  it("offers the last 5 minutes, what was decided and my items once the feed has entries, and sends the question picked", () => {
    const onPick = vi.fn();
    render(wrap(<ComposerSuggestions items={suggestions(true)} onPick={onPick} />));
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["5 phút qua", "Đã chốt gì?", "Việc của tôi"]);

    fireEvent.click(screen.getByRole("button", { name: "Đã chốt gì?" }));
    expect(onPick).toHaveBeenCalledWith("Cuộc họp đã chốt những gì?");
  });

  it("offers what the last meeting decided and this one's goal while the feed is empty", () => {
    const onPick = vi.fn();
    render(wrap(<ComposerSuggestions items={suggestions(false)} onPick={onPick} />));
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Lần trước chốt gì?", "Mục tiêu buổi này?"]);
    fireEvent.click(screen.getByRole("button", { name: "Mục tiêu buổi này?" }));
    expect(onPick).toHaveBeenCalledWith("Mục tiêu của cuộc họp này là gì?");
  });

  it("renders nothing without items", () => {
    const { container } = render(wrap(<ComposerSuggestions items={[]} onPick={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
});
