import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrap } from "../../test/api-mock";
import { DocumentsSettings } from "./documents-settings";

const { t } = initI18n();
const WS = "ws1";
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
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

const subscription = {
  subscription: {
    id: "s1",
    plan_code: "pro",
    plan_name: "Pro",
    status: "active",
    provider: "local",
    current_period_start: "2026-09-01T00:00:00Z",
    row_version: 1,
  },
  entitlements: [
    {
      feature_key: "documents.public_links",
      name: "Liên kết công khai",
      kind: "boolean",
      enabled: true,
    },
    {
      feature_key: "storage.bytes",
      name: "Dung lượng lưu trữ",
      kind: "quota",
      unit: "bytes",
      enabled: true,
      quota_limit: 10_737_418_240,
      current_usage: 536_870_912,
    },
  ],
};

function serve(over: { role?: string; settingsFails?: boolean; settings?: unknown } = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role: over.role ?? "owner" });
    if (path === `/api/v1/orgs/${ORG}/billing`) return Promise.resolve(subscription);
    if (path === `/api/v1/orgs/${ORG}/documents/settings`) {
      if (opts?.method === "PUT") {
        return Promise.resolve({
          organization_id: ORG,
          public_links_enabled: (opts.body as { public_links_enabled: boolean }).public_links_enabled,
        });
      }
      if (over.settingsFails) return Promise.reject(new Error("offline"));
      return Promise.resolve(
        over.settings ?? { organization_id: ORG, public_links_enabled: true },
      );
    }
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentsSettings />
      </WorkspaceProvider>,
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentsSettings", () => {
  it("shows the real entitlement, the storage quota and the stored switch", async () => {
    serve();
    renderTab();

    expect((await screen.findAllByText("Liên kết công khai")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("settings.documents.entitlement_enabled"))).toBeInTheDocument();
    // The quota meter reads the subscription's own usage and limit.
    const meter = await screen.findByRole("progressbar", { name: "Dung lượng lưu trữ" });
    expect(meter).toHaveAttribute("aria-valuenow", "5");

    const toggle = await screen.findByRole("switch", { name: t("settings.documents.links_toggle_label") });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("writes the switch through the server and keeps the answer", async () => {
    const puts: unknown[] = [];
    requestMock.mockReset();
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role: "owner" });
      if (path === `/api/v1/orgs/${ORG}/billing`) return Promise.resolve(subscription);
      if (path === `/api/v1/orgs/${ORG}/documents/settings`) {
        if (opts?.method === "PUT") {
          puts.push(opts.body);
          return Promise.resolve({ organization_id: ORG, public_links_enabled: false });
        }
        return Promise.resolve({ organization_id: ORG, public_links_enabled: true });
      }
      return Promise.resolve({});
    });
    renderTab();

    const toggle = await screen.findByRole("switch", { name: t("settings.documents.links_toggle_label") });
    // Wait for the stored value to land before flipping it.
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ public_links_enabled: false });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("tells a non-admin who can change it", async () => {
    serve({ role: "member" });
    renderTab();

    expect(await screen.findByText(t("settings.documents.admin_only"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the unknown state instead of a fabricated switch when the read fails", async () => {
    serve({ settingsFails: true });
    renderTab();

    expect(await screen.findByText(t("settings.documents.links_state_unknown"))).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
    // The failure is named, not swallowed.
    await waitFor(() =>
      expect(screen.getByText(t("settings.documents.links_read_failed"))).toBeInTheDocument(),
    );
  });
});
