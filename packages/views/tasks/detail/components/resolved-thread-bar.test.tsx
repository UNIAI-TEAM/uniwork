import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ResolvedThreadBar } from "./resolved-thread-bar";

initI18n();

describe("ResolvedThreadBar", () => {
  it("nói rõ luồng đã giải quyết và có bao nhiêu câu trả lời", () => {
    render(<ResolvedThreadBar replyCount={3} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId("resolved-thread-bar")).toHaveTextContent("3");
  });

  it("gọi onToggle khi bấm", () => {
    const onToggle = vi.fn();
    render(<ResolvedThreadBar replyCount={0} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("resolved-thread-bar"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
