import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { NodeHistorySection } from "./node-history-section";

const me: User = { id: "u1", email: "me@x.com", display_name: "Me", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi" };
const workspace: Workspace = { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "org", organization_name: "Org" };
const actor = (id: string, title: string) => ({ type: "ACTOR", id, subtype: "member", title, status: "active", workspace_id: "", workspace_slug: "", deleted: false });

beforeAll(() => initI18n());
beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) {
      return Promise.resolve({ node: null, items: [
        { kind: "edge", edge_type: "OWNED_BY", direction: "out", valid_from: "2026-10-03T02:00:00Z", valid_to: "2026-10-05T02:00:00Z", node: actor("u2", "An") },
        { kind: "edge", edge_type: "OWNED_BY", direction: "out", valid_from: "2026-10-05T02:00:00Z", node: actor("u3", "Bình") },
        { kind: "fact", fact_type: "due", valid_from: "2026-10-05T02:00:00Z", value: "2026-10-22", precision: "date", previous: "2026-10-15", previous_precision: "date" },
      ] });
    }
    return Promise.resolve({});
  });
});

it("reads the reassignment and the moved deadline as sentences", async () => {
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByRole("link", { name: "Giao cho Bình" })).toHaveAttribute("href", "/org/team/people/u3");
  expect(screen.getByText("Giao cho An")).toBeInTheDocument();
  expect(screen.getByText(/^Hạn đổi .+ → .+$/)).toBeInTheDocument();
});

it("names a deleted subtask without linking to a page that is gone", async () => {
  const subtask = { type: "TASK", id: "t2", subtype: "", title: "Viết báo cáo", status: "", workspace_id: "w1", workspace_slug: "team", deleted: true };
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) {
      return Promise.resolve({ node: null, items: [
        { kind: "edge", edge_type: "BELONGS_TO", direction: "in", valid_from: "2026-10-03T02:00:00Z", valid_to: "2026-10-06T02:00:00Z", node: subtask },
      ] });
    }
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByText("Viết báo cáo là công việc con của việc này")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("calls the task a sub-task of its parent with the product's term", async () => {
  const parent = { type: "TASK", id: "t0", subtype: "", title: "Ra mắt quý 4", status: "", workspace_id: "w1", workspace_slug: "team", deleted: false };
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) {
      return Promise.resolve({ node: null, items: [
        { kind: "edge", edge_type: "BELONGS_TO", direction: "out", valid_from: "2026-10-03T02:00:00Z", node: parent },
      ] });
    }
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByRole("link", { name: "Là công việc con của Ra mắt quý 4" })).toHaveAttribute("href", "/org/team/tasks/t0");
});

it("names statuses the way the status pill does, not by their seeded English names", async () => {
  // Built-ins are seeded with English names (task_status_catalog.go); a custom
  // status shows its own name.
  const status = (key: string, name: string, isSystem: boolean, position: number) => ({
    id: `s-${key}`, organization_id: "o1", workspace_id: "w1", key, name, description: "", category: isSystem ? key : "in_progress",
    color: "", is_system: isSystem, position, created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z",
  });
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) {
      return Promise.resolve({ statuses: [status("todo", "Todo", true, 1), status("in_progress", "In Progress", true, 2), status("waiting_client", "Chờ khách", false, 3)], categories: [], total: 3 });
    }
    if (p.includes("/history")) {
      return Promise.resolve({ node: null, items: [
        { kind: "fact", fact_type: "status", valid_from: "2026-10-03T02:00:00Z", valid_to: "2026-10-05T02:00:00Z", value: "waiting_client" },
        { kind: "fact", fact_type: "status", valid_from: "2026-10-05T02:00:00Z", value: "in_progress", previous: "todo" },
      ] });
    }
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByText("Trạng thái Cần làm → Đang làm")).toBeInTheDocument();
  expect(screen.getByText("Trạng thái Chờ khách")).toBeInTheDocument();
});

it("shows the empty state when the node is not projected yet", async () => {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) return Promise.reject(new ApiError("not found", "not_found", 404));
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByText("Chưa ghi nhận thay đổi nào.")).toBeInTheDocument();
});
