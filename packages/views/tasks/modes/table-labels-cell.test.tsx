import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskLabel } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { renderInTableRow } from "../../test/table-row";
import { TableLabelsCell } from "./table-cell-editors";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

function label(id: string, name: string, color: string): TaskLabel {
  return {
    id,
    organization_id: "o1",
    workspace_id: "w1",
    name,
    description: "",
    color,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

const catalog = [
  label("l1", "Bug", "#ef4444"),
  label("l2", "Frontend", "#3b82f6"),
  label("l3", "Backend", "#22c55e"),
];

function serveAttached(attached: TaskLabel[]) {
  requestMock.mockImplementation((_path: string, init?: { method?: string }) =>
    Promise.resolve(init?.method ? undefined : { labels: attached, total: attached.length }),
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

describe("TableLabelsCell", () => {
  it("hiện tối đa hai chip có màu rồi +N", async () => {
    serveAttached(catalog);
    render(wrap(<TableLabelsCell workspaceId="w1" taskId="t1" labels={catalog} />));
    const bug = await screen.findByText("Bug");
    expect(bug.className).toMatch(/bg-tint-red/);
    expect(screen.getByText("Frontend").className).toMatch(/bg-tint-blue/);
    expect(screen.queryByText("Backend")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nhãn: Bug, Frontend, +1" })).toBeInTheDocument();
  });

  it("không có nhãn thì tên truy cập nói giá trị Trống đang hiển thị", async () => {
    serveAttached([]);
    render(wrap(<TableLabelsCell workspaceId="w1" taskId="t1" labels={catalog} />));
    const trigger = await screen.findByRole("button", { name: "Nhãn: Trống" });
    expect(trigger).toHaveTextContent("Trống");
  });

  it("bấm trigger hay bấm một nhãn trong menu đều không điều hướng hàng", async () => {
    serveAttached([]);
    const onRowClick = vi.fn();
    render(
      wrap(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for DataTable's row wrapper; child control is interactive
        <div
          onClick={(e) => {
            if (e.defaultPrevented) return;
            onRowClick();
          }}
        >
          <TableLabelsCell workspaceId="w1" taskId="t1" labels={catalog} />
        </div>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /nhãn|labels/i }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1/labels", {
        method: "POST",
        body: { label_id: "l1" },
      }),
    );
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("trong hàng bảng thật: bấm trigger, bấm hay middle-click một nhãn đều không mở task", async () => {
    serveAttached([]);
    const { onOpenRow } = renderInTableRow(
      <TableLabelsCell workspaceId="w1" taskId="t1" labels={catalog} />,
      { wrapper: wrap },
    );
    fireEvent.click(screen.getByRole("button", { name: /nhãn|labels/i }));
    const bug = screen.getByRole("menuitemcheckbox", { name: "Bug" });
    fireEvent(bug, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent.click(bug);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1/labels", {
        method: "POST",
        body: { label_id: "l1" },
      }),
    );
    expect(onOpenRow).not.toHaveBeenCalled();
  });
});
