import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { ResolvedThreadBar } from "./resolved-thread-bar";

const i18n = initI18n();

afterEach(async () => {
  await i18n.changeLanguage("vi");
});

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

  it("dùng số ít trong tiếng Anh khi chỉ có một trả lời", async () => {
    await setLocale("en");
    render(<ResolvedThreadBar replyCount={1} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId("resolved-thread-bar")).toHaveTextContent(
      "Resolved thread · 1 reply",
    );
  });
});
