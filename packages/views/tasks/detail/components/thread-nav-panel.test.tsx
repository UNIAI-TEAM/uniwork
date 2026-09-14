import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ThreadNavPanel } from "./thread-nav-panel";

initI18n();

const threads = [
  { id: "r1", preview: "Câu đầu", replyCount: 2, resolved: false },
  { id: "r2", preview: "Câu sau", replyCount: 0, resolved: true },
  { id: "r3", preview: "Câu ba", replyCount: 1, resolved: false },
  { id: "r4", preview: "Câu bốn", replyCount: 0, resolved: false },
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

  it("không hiện gì khi có ba luồng trở xuống, vì lúc đó cuộn bằng mắt vẫn ổn", () => {
    const { container } = render(
      <ThreadNavPanel threads={threads.slice(0, 3)} onJump={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hiện bảng khi có từ bốn luồng trở lên", () => {
    render(<ThreadNavPanel threads={threads} onJump={vi.fn()} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByTestId("thread-nav-r4")).toBeInTheDocument();
  });
});
