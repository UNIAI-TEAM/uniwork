import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrap } from "../../test/api-mock";
import { AiAccessTab } from "./ai-access-tab";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { t } = initI18n();

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};
const user: User = {
  id: "u1",
  email: "minh@example.com",
  display_name: "Minh",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const grant = {
  id: "g1",
  organization_id: "o1",
  organization_name: "Acme",
  user_id: "u2",
  user_name: "Lan",
  client_id: "c1",
  client_name: "Claude",
  verified: true,
  scope: "read",
  created_at: "2026-10-12T08:00:00Z",
  last_used_at: null,
};

const SWITCH_NAME = "Cho phép trợ lý AI bên ngoài truy cập";
const WRITE_NAME = "Cho phép tạo và sửa";
const POLICY = {
  enabled: false,
  available: true,
  enabled_at: null,
  enabled_by: "",
  write_enabled: false,
  write_available: true,
  write_enabled_at: null,
  write_enabled_by: "",
  mcp_url: "https://api.example.test/mcp",
};

type Init = { method?: string; body?: { enabled?: boolean } };

function serve(
  role: string,
  policy: Record<string, unknown> = POLICY,
  opts: { grants?: unknown[]; grantsFail?: boolean; put?: (init: Init) => unknown; putWrite?: (init: Init) => unknown } = {},
) {
  let grants = opts.grants ?? [];
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path === "/api/v1/orgs/acme/mcp-policy/write" && init?.method === "PUT") {
      return opts.putWrite?.(init) ?? Promise.resolve({ ...policy, write_enabled: init.body?.enabled ?? false });
    }
    if (path === "/api/v1/orgs/acme/mcp-policy" && init?.method === "PUT") {
      return opts.put?.(init) ?? Promise.resolve({ ...policy, enabled: init.body?.enabled ?? false });
    }
    if (path === "/api/v1/orgs/acme/mcp-policy") return Promise.resolve(policy);
    if (path === "/api/v1/orgs/acme/connected-apps/g1" && init?.method === "DELETE") {
      grants = [];
      return Promise.resolve({ status: "ok" });
    }
    if (path === "/api/v1/orgs/acme/connected-apps") {
      return opts.grantsFail ? Promise.reject(new Error("down")) : Promise.resolve({ grants });
    }
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AiAccessTab />
      </WorkspaceProvider>,
    ),
  );
}

// react-query starts a mutation's request a few awaited ticks after the click,
// so a "no request was sent" assertion has to wait those out first or it passes
// even when the guard is missing.
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("AiAccessTab", () => {
  it("lets an owner turn the connector on", async () => {
    serve("owner");
    renderTab();
    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy", { method: "PUT", body: { enabled: true } }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("lets an admin turn it off again", async () => {
    serve("admin", { ...POLICY, enabled: true });
    renderTab();
    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy", { method: "PUT", body: { enabled: false } }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("says when the platform has not opened the feature, and refuses to turn it on", async () => {
    serve("owner", { ...POLICY, available: false });
    renderTab();
    expect(await screen.findByText("Tính năng chưa mở cho tổ chức của bạn.")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: SWITCH_NAME });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(toggle);
    await flush();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy", expect.objectContaining({ method: "PUT" }));
  });

  it("still lets an owner turn it off once the platform has closed the feature", async () => {
    serve("owner", { ...POLICY, available: false, enabled: true });
    renderTab();
    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(toggle).not.toHaveAttribute("aria-disabled");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy", { method: "PUT", body: { enabled: false } }),
    );
  });

  // Ruling 50: under an organization-level pilot a member's own settings may
  // not show the address yet, so the admin can hand it over.
  it("shows the address members paste, with the copy control", async () => {
    serve("admin", { ...POLICY, enabled: true });
    renderTab();
    expect(await screen.findByText(POLICY.mcp_url)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("settings.connectedApps.copy") })).toBeInTheDocument();
    expect(screen.getByText(t("settings.aiAccess.addressBody"))).toBeInTheDocument();
  });

  it("shows no address while the platform has not opened the feature", async () => {
    serve("owner", { ...POLICY, available: false });
    renderTab();
    expect(await screen.findByText(t("settings.aiAccess.unavailable"))).toBeInTheDocument();
    expect(screen.queryByText(POLICY.mcp_url)).not.toBeInTheDocument();
  });

  it("shows members the admin-only state without asking for the policy", async () => {
    serve("member", { ...POLICY, enabled: true });
    renderTab();
    expect(await screen.findByText(t("settings.aiAccess.adminOnly"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/connected-apps");
  });

  it("keeps one write at a time and names a failed save", async () => {
    let release: (value: unknown) => void = () => undefined;
    serve("owner", POLICY, { put: () => new Promise((resolve) => { release = resolve; }) });
    renderTab();
    const toggle = await screen.findByRole("switch", { name: SWITCH_NAME });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(toggle);
    const puts = () => requestMock.mock.calls.filter(([, init]) => (init as Init | undefined)?.method === "PUT");
    expect(puts()).toHaveLength(1);
    release(null);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("settings.aiAccess.saveFailed"));
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled"));
    // The write did not land, so the switch must not claim it did.
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("lets an owner switch write on through its own route", async () => {
    serve("owner", { ...POLICY, enabled: true });
    renderTab();
    const write = await screen.findByRole("switch", { name: WRITE_NAME });
    expect(write).toHaveAttribute("aria-checked", "false");
    expect(write).not.toHaveAttribute("aria-disabled");
    fireEvent.click(write);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy/write", { method: "PUT", body: { enabled: true } }),
    );
    await waitFor(() => expect(write).toHaveAttribute("aria-checked", "true"));
  });

  it("keeps write off, and says why, while the connector is off", async () => {
    serve("owner", { ...POLICY, enabled: false });
    renderTab();
    const write = await screen.findByRole("switch", { name: WRITE_NAME });
    expect(write).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Bật truy cập của trợ lý AI trước.")).toBeInTheDocument();
    fireEvent.click(write);
    await flush();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy/write", expect.anything());
  });

  it("keeps write off, and says why, while the platform has not opened it", async () => {
    serve("owner", { ...POLICY, enabled: true, write_available: false });
    renderTab();
    const write = await screen.findByRole("switch", { name: WRITE_NAME });
    expect(write).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Quyền ghi chưa mở cho tổ chức của bạn.")).toBeInTheDocument();
    fireEvent.click(write);
    await flush();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy/write", expect.anything());
  });

  it("always lets an owner switch write off, even once it can no longer be switched on", async () => {
    serve("owner", { ...POLICY, enabled: false, write_available: false, write_enabled: true });
    renderTab();
    const write = await screen.findByRole("switch", { name: WRITE_NAME });
    await waitFor(() => expect(write).toHaveAttribute("aria-checked", "true"));
    expect(write).not.toHaveAttribute("aria-disabled");
    fireEvent.click(write);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/mcp-policy/write", { method: "PUT", body: { enabled: false } }),
    );
  });

  it("names a write that did not save and leaves the switch where it was", async () => {
    serve("owner", { ...POLICY, enabled: true }, { putWrite: () => Promise.resolve(null) });
    renderTab();
    const write = await screen.findByRole("switch", { name: WRITE_NAME });
    fireEvent.click(write);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("settings.aiAccess.saveFailed"));
    expect(write).toHaveAttribute("aria-checked", "false");
  });

  it("labels each grant with what it may do", async () => {
    serve("owner", POLICY, { grants: [{ ...grant, id: "g1", client_name: "Claude", scope: "read write" }, { ...grant, id: "g2", client_name: "ChatGPT", scope: "read" }] });
    renderTab();
    const list = await screen.findByRole("list", { name: t("settings.aiAccess.grantsTitle") });
    const [claude, chatgpt] = within(list).getAllByRole("listitem");
    expect(within(claude!).getByText("Đọc và ghi")).toBeInTheDocument();
    expect(within(claude!).queryByText("Chỉ đọc")).not.toBeInTheDocument();
    expect(within(chatgpt!).getByText("Chỉ đọc")).toBeInTheDocument();
  });

  it("lists the organization's grants and revokes one only after confirming", async () => {
    serve("owner", POLICY, { grants: [grant] });
    renderTab();
    const list = await screen.findByRole("list", { name: t("settings.aiAccess.grantsTitle") });
    expect(within(list).getByText("Claude")).toBeInTheDocument();
    expect(within(list).getByText(t("settings.connectedApps.verified"))).toBeInTheDocument();
    expect(within(list).getByText(/Lan · kết nối /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi Claude của Lan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Ứng dụng của Lan mất quyền đọc dữ liệu tổ chức ngay.")).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/connected-apps/g1", { method: "DELETE" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/connected-apps/g1", { method: "DELETE" }),
    );
    expect(await screen.findByText(t("settings.aiAccess.empty"))).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Đã thu hồi Claude");
  });

  it("renders a row whose created date did not come through, and keeps the switch", async () => {
    serve("owner", POLICY, { grants: [{ ...grant, created_at: "" }] });
    renderTab();
    const list = await screen.findByRole("list", { name: t("settings.aiAccess.grantsTitle") });
    expect(within(list).getByText("Claude")).toBeInTheDocument();
    expect(within(list).getByText("Lan")).toBeInTheDocument();
    expect(within(list).queryByText(/kết nối/)).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: SWITCH_NAME })).toBeInTheDocument();
  });

  it("keeps the dialog open when the revoke fails, and closes it on cancel", async () => {
    serve("owner", POLICY, { grants: [grant] });
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: string, init?: Init) =>
      path === "/api/v1/orgs/acme/connected-apps/g1" && init?.method === "DELETE"
        ? Promise.reject(new Error(""))
        : base?.(path, init),
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi Claude của Lan" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    // An error with no message of its own: the toast falls back to our sentence.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t("settings.aiAccess.revokeFailed")));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("shows the empty line when nobody has connected an app", async () => {
    serve("owner");
    renderTab();
    expect(await screen.findByText(t("settings.aiAccess.empty"))).toBeInTheDocument();
  });

  it("shows a retry when the grants fail to load", async () => {
    serve("owner", POLICY, { grantsFail: true });
    renderTab();
    expect(await screen.findByText(t("settings.aiAccess.error"))).toBeInTheDocument();
    serve("owner", POLICY, { grants: [grant] });
    fireEvent.click(screen.getByRole("button", { name: t("settings.state.retry") }));
    expect(await screen.findByText("Claude")).toBeInTheDocument();
  });

  it("does not call an unloaded list empty", async () => {
    serve("owner");
    const base = requestMock.getMockImplementation();
    requestMock.mockImplementation((path: string, init?: Init) =>
      path === "/api/v1/orgs/acme/connected-apps" ? new Promise(() => undefined) : base?.(path, init),
    );
    renderTab();
    await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(screen.queryByText(t("settings.aiAccess.empty"))).not.toBeInTheDocument();
  });

  it("says the switch did not load, with a retry, instead of a dead switch", async () => {
    serve("owner");
    const base = requestMock.getMockImplementation();
    let fail = true;
    requestMock.mockImplementation((path: string, init?: Init) =>
      path === "/api/v1/orgs/acme/mcp-policy" && !init?.method && fail ? Promise.reject(new Error("down")) : base?.(path, init),
    );
    renderTab();
    expect(await screen.findByText(t("settings.state.load_error"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("settings.state.retry") }));
    expect(await screen.findByRole("switch", { name: SWITCH_NAME })).toBeInTheDocument();
  });

  it("treats a policy answer it cannot read as a failed load", async () => {
    serve("owner", {});
    renderTab();
    expect(await screen.findByText(t("settings.state.load_error"))).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
