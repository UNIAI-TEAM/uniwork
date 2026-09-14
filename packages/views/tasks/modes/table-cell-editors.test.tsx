import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  TableAssigneeCell,
  TablePriorityCell,
  TableStatusCell,
} from "./table-cell-editors";

beforeAll(() => {
  initI18n();
});

const members = [{ id: "u1", name: "An Nguyễn" }];

describe("table cell pickers: accessible name contains the visible value", () => {
  it("status", () => {
    render(<TableStatusCell value="in_progress" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Trạng thái: Đang làm" });
    expect(trigger).toHaveTextContent("Đang làm");
  });

  it("priority", () => {
    render(<TablePriorityCell value="high" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /^Độ ưu tiên: / });
    expect(trigger).toHaveAccessibleName(`Độ ưu tiên: ${trigger.textContent?.trim()}`);
  });

  it("assignee", () => {
    render(<TableAssigneeCell assigneeId="u1" members={members} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox", { name: "Người phụ trách: An Nguyễn" });
    expect(trigger).toHaveTextContent("An Nguyễn");
  });

  it("unassigned", () => {
    render(<TableAssigneeCell members={members} onChange={vi.fn()} />);
    expect(
      screen.getByRole("combobox", { name: "Người phụ trách: Chưa giao" }),
    ).toHaveTextContent("Chưa giao");
  });

  it("agent keeps the visible badge text in the name", () => {
    render(
      <TableAssigneeCell
        assigneeId="a1"
        assigneeName="Trợ lý QA"
        assigneeKind="agent"
        members={members}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: /^Người phụ trách: Trợ lý QA / });
    expect(trigger).toHaveTextContent("Agent");
    expect(trigger).toHaveAccessibleName("Người phụ trách: Trợ lý QA Agent");
  });
});
