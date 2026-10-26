import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function serve(role: string, puts: unknown[] = [], read?: () => Promise<unknown>) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path === `/api/v1/orgs/${ORG}/meetings/transcript-retention` && opts?.method === "PUT") {
      puts.push(opts.body);
      return Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, ...(opts.body as object) });
    }
    if (path === `/api/v1/orgs/${ORG}/meetings/settings`) {
      if (opts?.method === "PUT") {
        puts.push(opts.body);
        return Promise.resolve({ organization_id: ORG, ...(opts.body as object) });
      }
      return read ? read() : Promise.resolve({ organization_id: ORG, auto_summary_enabled: true });
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
    expect(toggle).toHaveAccessibleDescription(t("settings.meetings.auto_summary_description"));
    fireEvent.click(toggle);
    await waitFor(() => expect(puts).toEqual([{ auto_summary_enabled: false }]));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(await screen.findByText(t("settings.save.saved"))).toBeInTheDocument();
  });

  it("holds the row's shape while the read runs, never a guessed off switch", async () => {
    serve("owner", [], () => new Promise(() => {}));
    renderTab();
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meetings/settings"))).toBe(true));
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("names a failed read and reads again on retry", async () => {
    let reads = 0;
    serve("owner", [], () => (++reads === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ organization_id: ORG, auto_summary_enabled: true })));
    renderTab();
    expect(await screen.findByText(t("settings.meetings.read_failed"), { exact: false })).toBeInTheDocument();
    // Only the failure: no switch drawn "off" when the real default is on.
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("settings.state.retry") }));
    const toggle = await screen.findByRole("switch", { name: t("settings.meetings.auto_summary_label") });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByText(t("settings.meetings.read_failed"), { exact: false })).toBeNull();
    expect(reads).toBe(2);
  });

  // UNI-1995 access (#16): the AI scribe policy, one of three.
  it("shows the stored scribe policy and writes a new one through the server", async () => {
    const puts: unknown[] = [];
    serve("admin", puts, () => Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, scribe_policy: "on" }));
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role: "admin" });
      if (opts?.method === "PUT") {
        puts.push(opts.body);
        return Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, ...(opts.body as object) });
      }
      return Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, scribe_policy: "on" });
    });
    renderTab();
    const on = await screen.findByRole("radio", { name: new RegExp(t("settings.meetings.scribe_policy_on")) });
    expect(on).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(t("settings.meetings.scribe_policy_opt_in")) }));
    await waitFor(() => expect(puts).toEqual([{ scribe_policy: "opt_in" }]));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: new RegExp(t("settings.meetings.scribe_policy_opt_in")) })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("shows the organization's transcript retention (UNI-1995 #5)", async () => {
    serve("owner", [], () => Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, transcript_retention_days: 90 }));
    renderTab();
    const select = await screen.findByRole("combobox", { name: t("settings.meetings.retention_label") });
    await waitFor(() => expect(select).toHaveTextContent(t("settings.meetings.retention_days", { count: 90 })));
  });

  async function pickRetention(label: string) {
    const select = await screen.findByRole("combobox", { name: t("settings.meetings.retention_label") });
    fireEvent.click(select);
    const option = await screen.findByRole("option", { name: label });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
  }

  it("asks before a shorter retention deletes old transcripts, and saves only once confirmed (UNI-1995 #5)", async () => {
    const puts: unknown[] = [];
    serve("owner", puts, () => Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, transcript_retention_days: null }));
    renderTab();
    await pickRetention(t("settings.meetings.retention_days", { count: 30 }));
    const dialog = await screen.findByRole("alertdialog", { name: t("settings.meetings.retention_shrink_title", { days: 30 }) });
    expect(dialog).toHaveTextContent(t("settings.meetings.retention_shrink_description", { days: 30 }));
    expect(puts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: t("settings.meetings.retention_shrink_confirm") }));
    await waitFor(() => expect(puts).toEqual([{ transcript_retention_days: 30 }]));
  });

  it("saves a longer retention without asking, and a cancelled shrink saves nothing", async () => {
    const puts: unknown[] = [];
    serve("owner", puts, () => Promise.resolve({ organization_id: ORG, auto_summary_enabled: true, transcript_retention_days: 90 }));
    renderTab();
    await pickRetention(t("settings.meetings.retention_days", { count: 30 }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await pickRetention(t("settings.meetings.retention_forever"));
    await waitFor(() => expect(puts).toEqual([{ transcript_retention_days: null }]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("tells a member who can change it, without reading the settings", async () => {
    serve("member");
    renderTab();
    expect(await screen.findByText(t("settings.meetings.admin_only"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meetings/settings"))).toBe(false);
  });
});
