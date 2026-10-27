import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { RecorderState } from "@uniwork/core/meetings/recorder";
import { wrapWithNav } from "../../test/api-mock";
import { RecordStage } from "./record-stage";

beforeAll(() => {
  initI18n();
});

function renderStage(over: Partial<{ state: RecorderState; wakeLockHeld: boolean; people: number }> = {}) {
  const handlers = { onPause: vi.fn(), onResume: vi.fn(), onResumeAfterInterrupt: vi.fn(), onDeviceChange: vi.fn(), onEnd: vi.fn() };
  render(
    wrapWithNav(
      <RecordStage
        workspaceLabel="Vận hành"
        meetingsHref="/o/w/meetings"
        state={over.state ?? "recording"}
        elapsedMs={42 * 60_000 + 18_000}
        stream={null}
        wakeLockHeld={over.wakeLockHeld ?? true}
        people={over.people ?? 7}
        mics={[
          { deviceId: "mic1", label: "Built-in Mic" },
          { deviceId: "mic2", label: "Jabra Speak" },
        ]}
        deviceId="mic1"
        {...handlers}
      />,
    ),
  );
  return handlers;
}

describe("RecordStage", () => {
  it("reads out the clock, what is saved, the screen lock and the attendees", () => {
    renderStage();
    expect(screen.getByRole("timer")).toHaveTextContent("42:18");
    expect(screen.getByText("Đang ghi âm")).toBeInTheDocument();
    expect(screen.getAllByText("Đã lưu trên máy")).toHaveLength(2);
    expect(screen.getByText("Màn hình luôn sáng")).toBeInTheDocument();
    expect(screen.getByText("7 người dự")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cuộc họp" })).toHaveAttribute("href", "/o/w/meetings");
  });

  it("claims the screen stays on only while it holds the lock", () => {
    renderStage({ wakeLockHeld: false });
    expect(screen.queryByText("Màn hình luôn sáng")).not.toBeInTheDocument();
  });

  it("shows a paused clock in the warning colour and offers to resume", () => {
    const h = renderStage({ state: "paused" });
    expect(screen.getByText("Đã tạm dừng")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveClass("text-warning");
    fireEvent.click(screen.getByRole("button", { name: "Ghi tiếp" }));
    expect(h.onResume).toHaveBeenCalled();
  });

  it("ends from the header and from the bar", () => {
    const h = renderStage();
    for (const end of screen.getAllByRole("button", { name: "Kết thúc" })) fireEvent.click(end);
    expect(h.onEnd).toHaveBeenCalledTimes(2);
  });

  it("switches to another microphone", async () => {
    const h = renderStage();
    fireEvent.click(screen.getByRole("button", { name: "Thiết bị" }));
    fireEvent.click(await screen.findByRole("button", { name: "Jabra Speak" }));
    expect(h.onDeviceChange).toHaveBeenCalledWith("mic2");
  });
});
