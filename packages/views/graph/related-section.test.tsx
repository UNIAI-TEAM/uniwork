import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { RelatedSection } from "./related-section";

const me: User = { id: "u1", email: "me@x.com", display_name: "Me", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi" };
const workspace: Workspace = { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "org", organization_name: "Org" };
const meeting = { type: "MEETING", id: "m1", subtype: "", title: "Giao ban thứ hai", status: "ENDED", workspace_id: "w1", workspace_slug: "team", deleted: false };

function respond(flag: boolean, neighbors: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: flag }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.includes("/graph/nodes/TASK/t1/neighbors")) return neighbors();
    return Promise.resolve({});
  });
}

function shell() {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      <RelatedSection workspaceId="w1" nodeType="TASK" nodeId="t1" />
    </WorkspaceProvider>,
  );
}

beforeAll(() => initI18n());
beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
});

describe("RelatedSection", () => {
  it("groups neighbors and links the meeting a task came from", async () => {
    respond(true, () => Promise.resolve({ node: null, items: [{ edge_type: "ORIGINATED_FROM", direction: "out", origin: "SYSTEM", valid_from: "2026-10-07T00:00:00Z", backfilled: false, node: meeting }] }));
    render(shell());
    expect(await screen.findByText("Xuất phát từ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Giao ban thứ hai" })).toHaveAttribute("href", "/org/team/meetings/m1");
  });

  it("renders nothing while the organization has the graph off", async () => {
    respond(false, () => Promise.resolve({ items: [] }));
    const { container } = render(shell());
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a retry when the neighbors fail", async () => {
    respond(true, () => Promise.reject(new ApiError("boom", "internal", 500)));
    render(shell());
    expect(await screen.findByText("Không tải được mục liên quan.")).toBeInTheDocument();
    respond(true, () => Promise.resolve({ items: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có gì liên quan/)).toBeInTheDocument();
  });
});
