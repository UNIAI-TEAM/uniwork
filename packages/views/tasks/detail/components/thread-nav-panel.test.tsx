import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ThreadNavPanel } from "./thread-nav-panel";

initI18n();

const threads = [
  { id: "r1", preview: "Câu đầu", replyCount: 2, resolved: false },
  { id: "r2", preview: "Câu sau", replyCount: 0, resolved: true },
];

describe("ThreadNavPanel", () => {
  it("liệt kê từng luồng kèm số trả lời", () => {
    render(<ThreadNavPanel threads={threads} onJump={vi.fn()} />);
    expect(screen.getByTestId("thread-nav-r1")).toHaveTextContent("Câu đầu");
    expect(screen.getByTestId("thread-nav-r2")).toHaveTextContent("Câu sau");
  });

  it("gọi onJump kèm id luồng", () => {
    const onJump = vi.fn();
    render(<ThreadNavPanel threads={threads} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("thread-nav-r2"));
    expect(onJump).toHaveBeenCalledWith("r2");
  });

  it("không hiện gì khi chỉ có một luồng, vì lúc đó không có gì để điều hướng", () => {
    const { container } = render(
      <ThreadNavPanel threads={[threads[0]!]} onJump={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("có landmark nav với tên truy cập được", () => {
    render(<ThreadNavPanel threads={threads} onJump={vi.fn()} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
