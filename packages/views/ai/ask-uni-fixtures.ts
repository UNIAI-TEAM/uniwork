// Test fixtures shared by the Ask UNI composer suites (not exported to the app).
import { createElement, type ReactElement } from "react";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import type { User, Workspace } from "@uniwork/core/types";

/** Wraps a screen so the `ask_uni_stream` flag reads on. */
export function withAskUniDock(ui: ReactElement): ReactElement {
  const service = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: true } }));
  return createElement(FeatureFlagsProvider, { service, children: ui });
}

export const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
export const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

export const MODELS = [
  { key: "haiku", speed: 5, intelligence: 3, cost: 1, enabled: true },
  { key: "sonnet", speed: 4, intelligence: 4, cost: 2, enabled: true },
  { key: "opus", speed: 2, intelligence: 5, cost: 5, enabled: true },
  { key: "fable", speed: 3, intelligence: 4, cost: 3, enabled: false },
];

export const capabilities = (models = MODELS) => ({
  enabled: true, ask_uni: true, meeting_summary: true,
  quota: { used_tokens: 0, limit_tokens: null }, models, auto_model: "sonnet",
});

const task = (id: string, title: string) => ({
  id, workspace_id: "ws1", identifier: id.toUpperCase(), title, description: "", created_by: "u1", status: "todo",
  priority: "medium", position: 1, revision: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
});

const project = { id: "p1", organization_id: "o1", workspace_id: "ws1", title: "Website", description: "", status: "active",
  priority: "medium", revision: 1, task_count: 0, done_count: 0, resource_count: 0, created_at: "", updated_at: "" };
const meeting = { id: "m1", workspace_id: "ws1", title: "Họp tuần", description: "", starts_at: "", ends_at: "", room_name: "r", created_by: "u1" };
const doc = { id: "d1", workspace_id: "ws1", kind: "page", title: "Lập kế hoạch Q4", revision: "1" };

/** The server side of every request the composer makes. */
export function composerRoutes(path: string, init?: { body?: { query?: { search?: string } } }) {
  if (path.endsWith("/ai/capabilities")) return Promise.resolve(capabilities());
  if (path.endsWith("/members")) {
    return Promise.resolve({ members: [{ workspace_id: "ws1", user_id: "u2", role: "member", email: "lan@x.vn", display_name: "Lan Anh" }] });
  }
  if (path.endsWith("/tasks/table/rows")) {
    const q = init?.body?.query?.search?.toLowerCase() ?? "";
    const rows = q.startsWith("la") ? [{ task: task("t1", "Lập kế hoạch"), direct_child_count: 0, labels: [] }] : [];
    return Promise.resolve({ query_fingerprint: "f", group_key: null, parent_id: null, total: rows.length, rows, next_cursor: null });
  }
  // A query nothing matches ("zz") finds nothing anywhere.
  const none = /[?&]q=zz/.test(path);
  if (path.includes("/projects")) return none ? Promise.resolve({ projects: [], total: 0 }) : Promise.resolve({ projects: [project], total: 1 });
  if (path.includes("/meetings")) return none ? Promise.resolve({ meetings: [], total: 0 }) : Promise.resolve({ meetings: [meeting], total: 1 });
  if (path.includes("/documents")) return none ? Promise.resolve({ documents: [], next_cursor: null }) : Promise.resolve({ documents: [doc], next_cursor: null });
  if (path.includes("/chat/rooms")) {
    return Promise.resolve({ rooms: [{ id: "r1", kind: "channel", name: "general", workspace_id: "ws1", member_count: 3 }] });
  }
  return Promise.resolve({});
}
