import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { PriorityPicker } from "./priority-picker";
import { StatusPicker } from "./status-picker";

initI18n();

function catalogStatus(key: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${key}`,
    organization_id: "o1",
    workspace_id: "w1",
    key,
    name,
    description: "",
    category: key,
    color: "#64748b",
    is_system: true,
    position: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

function serveCatalog(statuses: unknown[]) {
  requestMock.mockImplementation((path: string) =>
    path.endsWith("/task-statuses")
      ? Promise.resolve({ statuses, categories: [], total: statuses.length })
      : Promise.resolve({}),
  );
}

describe("StatusPicker", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("khi catalog chưa có thì liệt kê 7 trạng thái mặc định, trigger mặc định có icon và nhãn", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    render(wrap(<StatusPicker workspaceId="w1" value="todo" onChange={vi.fn()} ariaLabel="Trạng thái" />));
    const trigger = screen.getByRole("button", { name: "Trạng thái: Cần làm" });
    expect(trigger.querySelector('[data-slot="status-icon"]')).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Cần làm", pressed: true })).toBeInTheDocument();
  });

  it("liệt kê trạng thái tuỳ chỉnh của workspace theo thứ tự, bỏ trạng thái đã lưu trữ", async () => {
    serveCatalog([
      catalogStatus("todo", "Todo", { position: 1 }),
      catalogStatus("qa", "Chờ QA", { is_system: false, category: "in_review", color: "#22c55e", position: 2 }),
      catalogStatus("old", "Cũ", { is_system: false, category: "backlog", position: 3, archived_at: "2026-09-02T00:00:00Z" }),
    ]);
    const onChange = vi.fn();
    render(wrap(<StatusPicker workspaceId="w1" value="todo" onChange={onChange} ariaLabel="Trạng thái" />));
    fireEvent.click(screen.getByRole("button", { name: "Trạng thái: Cần làm" }));
    const custom = await screen.findByRole("button", { name: "Chờ QA" });
    expect(screen.queryByRole("button", { name: "Cũ" })).not.toBeInTheDocument();
    expect(custom.querySelector('[data-slot="status-icon"]')).toHaveStyle({ color: "#22c55e" });
    fireEvent.click(custom);
    expect(onChange).toHaveBeenCalledWith("qa");
  });

  it("trigger hiển thị tên trạng thái tuỳ chỉnh, kể cả khi nó đã lưu trữ", async () => {
    serveCatalog([
      catalogStatus("old", "Cũ", { is_system: false, category: "backlog", archived_at: "2026-09-02T00:00:00Z" }),
    ]);
    render(wrap(<StatusPicker workspaceId="w1" value="old" onChange={vi.fn()} ariaLabel="Trạng thái" />));
    expect(await screen.findByRole("button", { name: "Trạng thái: Cũ" })).toBeInTheDocument();
  });
});

describe("PriorityPicker", () => {
  it("dòng là chip màu có icon; trigger mặc định có icon và nhãn", () => {
    const onChange = vi.fn();
    render(<PriorityPicker value="none" onChange={onChange} ariaLabel="Độ ưu tiên" />);
    const trigger = screen.getByRole("button", { name: "Độ ưu tiên: Không ưu tiên" });
    expect(trigger.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    fireEvent.click(trigger);
    const high = screen.getByRole("button", { name: "Cao" });
    expect(high.querySelector('[data-slot="priority-chip"] [data-slot="priority-icon"]')).not.toBeNull();
    fireEvent.click(high);
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
