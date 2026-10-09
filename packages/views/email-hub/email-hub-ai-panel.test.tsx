import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { EmailHubAiPanel } from "./email-hub-ai-panel";

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};
const summary = {
  summary: "Khách cần báo giá",
  key_points: [],
  action_items: [{ title: "Gửi báo giá", owner: "", due: "" }],
  needs_reply: false,
  reply_hint: "",
  model: "",
  cached: true,
  summarized_at: "2026-10-07T00:00:00Z",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/ai/capabilities")) return Promise.resolve({ enabled: true });
    if (p.endsWith("/ai/summary/tasks") && opts?.method === "POST") return Promise.resolve({ task_ids: ["t1"] });
    if (p.includes("/projects")) return Promise.resolve({ projects: [], total: 0 });
    return Promise.resolve({ members: [] });
  });
});

describe("EmailHubAiPanel", () => {
  it("creates tasks from the thread summary with the account and the picked items", async () => {
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={me}>
          <EmailHubAiPanel wsId="w1" accountId="a1" threadId="th1" bodyReady initialSummary={summary} />
        </WorkspaceProvider>,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tạo 1 việc" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/w1/email-hub/threads/th1/ai/summary/tasks",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ account_id: "a1", items: [expect.objectContaining({ title: "Gửi báo giá" })] }),
        }),
      ),
    );
  });
});
