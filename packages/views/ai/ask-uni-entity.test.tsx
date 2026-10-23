import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AiCitation } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniEntityChip, AskUniSources } from "./ask-uni-entity";

initI18n();

const task: AiCitation = { source_id: "S1", kind: "task", object_id: "T1", title: "Sửa lỗi crash", quote: "", href: "/acme/team/tasks/T1" };
const person: AiCitation = { source_id: "S2", kind: "member", object_id: "u7", title: "Lan Phạm", quote: "", href: "/acme/team/people/u7" };

const taskBody = {
  id: "T1", workspace_id: "ws1", identifier: "UNI-1", title: "Sửa lỗi crash", description: "", status: "in_progress", priority: "high",
  position: 0, created_by: "u1", created_at: "", updated_at: "", due_date: "2026-11-01",
};
const member = { workspace_id: "ws1", user_id: "u7", role: "admin", email: "lan@x.vn", display_name: "Lan Phạm" };

function mount(source: AiCitation) {
  return render(wrapWithNav(<AskUniEntityChip source={source} wsId="ws1" />));
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.includes("/tasks/T1")) return Promise.resolve({ task: taskBody });
    if (path.includes("/members")) return Promise.resolve({ members: [member] });
    return Promise.resolve({});
  });
});

describe("AskUniEntityChip", () => {
  it("links the name and labels it with the kind", () => {
    mount(task);
    const link = screen.getByRole("link", { name: "Task: Sửa lỗi crash" });
    expect(link).toHaveAttribute("href", task.href);
  });

  it("shows the live task status", async () => {
    mount(task);
    expect(await screen.findByText("Đang làm")).toBeInTheDocument();
  });

  it("keeps the stored name and says unavailable on a 404", async () => {
    requestMock.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    mount(task);
    const link = screen.getByRole("link", { name: "Task: Sửa lỗi crash" });
    fireEvent.focus(link);
    expect(await screen.findByText("Không còn xem được đối tượng này.")).toBeInTheDocument();
    expect(link).toHaveTextContent("Sửa lỗi crash");
  });

  it("opens the card on keyboard focus with the task's details", async () => {
    mount(task);
    fireEvent.focus(screen.getByRole("link", { name: "Task: Sửa lỗi crash" }));
    expect(await screen.findByText("UNI-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở" })).toHaveAttribute("href", task.href);
  });

  it("finds the person by user_id in the workspace members", async () => {
    mount(person);
    fireEvent.focus(screen.getByRole("link", { name: "Người: Lan Phạm" }));
    expect(await screen.findByText("Quản trị")).toBeInTheDocument();
    expect(screen.getAllByText("Lan Phạm").length).toBeGreaterThan(1);
  });

  it("renders a non-internal href as plain text", () => {
    mount({ ...task, href: "https://evil.test/x" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Sửa lỗi crash")).toBeInTheDocument();
  });
});

describe("AskUniSources", () => {
  it("collapses to a count and expands to the list", () => {
    render(wrapWithNav(<AskUniSources citations={[task, person]} />));
    const toggle = screen.getByRole("button", { name: "Nguồn (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
