import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TrashList, type TrashItem } from "./trash-list";

initI18n();

const item = (over: Partial<TrashItem> = {}): TrashItem => ({
  id: "t1",
  title: "Soạn hợp đồng",
  subtitle: "UW-7",
  trashedAt: "2026-10-20T08:00:00Z",
  trashedByName: "Lan",
  purgeAfter: "2026-11-19T08:00:00Z",
  extraCount: 0,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T08:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("TrashList", () => {
  it("shows the title, who trashed it and the days left rounded up", () => {
    render(<TrashList kind="task" items={[item({ purgeAfter: "2026-11-19T09:00:00Z" })]} onRestore={vi.fn()} onPurge={vi.fn()} />);
    expect(screen.getByText("Soạn hợp đồng")).toBeInTheDocument();
    expect(screen.getByText("UW-7")).toBeInTheDocument();
    expect(screen.getByText(/Xóa bởi Lan lúc/)).toBeInTheDocument();
    // 23 days and 1 hour left -> 24
    expect(screen.getByText("Tự xóa vĩnh viễn sau 24 ngày")).toBeInTheDocument();
  });

  it("never shows a negative day count", () => {
    render(<TrashList kind="task" items={[item({ purgeAfter: "2026-10-01T00:00:00Z" })]} onRestore={vi.fn()} onPurge={vi.fn()} />);
    expect(screen.getByText("Tự xóa vĩnh viễn sau 0 ngày")).toBeInTheDocument();
  });

  it("shows the subtask count for a task batch and the task count for a project", () => {
    const { rerender } = render(
      <TrashList kind="task" items={[item({ extraCount: 3 })]} onRestore={vi.fn()} onPurge={vi.fn()} />,
    );
    expect(screen.getByText("Gồm 3 task con")).toBeInTheDocument();
    rerender(<TrashList kind="project" items={[item({ extraCount: 4 })]} onRestore={vi.fn()} onPurge={vi.fn()} />);
    expect(screen.getByText("4 công việc trong dự án")).toBeInTheDocument();
  });

  it("restores a row straight away", () => {
    const onRestore = vi.fn();
    render(<TrashList kind="task" items={[item()]} onRestore={onRestore} onPurge={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục Soạn hợp đồng" }));
    expect(onRestore).toHaveBeenCalledWith("t1");
  });

  it("purges only after the confirm dialog that says it cannot be undone", () => {
    const onPurge = vi.fn();
    render(<TrashList kind="task" items={[item()]} onRestore={vi.fn()} onPurge={onPurge} />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn Soạn hợp đồng" }));
    expect(onPurge).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Không hoàn tác được/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    expect(onPurge).toHaveBeenCalledWith("t1");
  });

  it("cancel closes the purge dialog without purging", () => {
    const onPurge = vi.fn();
    render(<TrashList kind="task" items={[item()]} onRestore={vi.fn()} onPurge={onPurge} />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa vĩnh viễn Soạn hợp đồng" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Hủy" }));
    expect(onPurge).not.toHaveBeenCalled();
  });

  it("loads more when asked", () => {
    const onLoadMore = vi.fn();
    render(
      <TrashList kind="task" items={[item()]} onRestore={vi.fn()} onPurge={vi.fn()} hasMore onLoadMore={onLoadMore} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
