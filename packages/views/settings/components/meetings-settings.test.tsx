import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrap } from "../../test/api-mock";
import { MeetingsSettings } from "./meetings-settings";

const { t } = initI18n();
const ORG = "o1";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

function serve(role: string, puts: unknown[] = []) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path === `/api/v1/orgs/${ORG}/meetings/settings`) {
      if (opts?.method === "PUT") {
        puts.push(opts.body);
        return Promise.resolve({ organization_id: ORG, ...(opts.body as object) });
      }
      return Promise.resolve({ organization_id: ORG, auto_summary_enabled: true });
    }
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <MeetingsSettings />
      </WorkspaceProvider>,
    ),
  );
}

describe("MeetingsSettings (UNI-2026)", () => {
  it("shows the stored auto summary switch and writes a flip through the server", async () => {
    const puts: unknown[] = [];
    serve("owner", puts);
    renderTab();
    const toggle = await screen.findByRole("switch", { name: t("settings.meetings.auto_summary_label") });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    await waitFor(() => expect(puts).toEqual([{ auto_summary_enabled: false }]));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("tells a member who can change it, without reading the settings", async () => {
    serve("member");
    renderTab();
    expect(await screen.findByText(t("settings.meetings.admin_only"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meetings/settings"))).toBe(false);
  });
});
