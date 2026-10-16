import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { DocumentSchema } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";
import type { ShareDialogTarget } from "./share-dialog-target";

// DOC6-W01 (access addendum §2.4, §2.5; W-DOC06, UNI-1630). The transport is
// mocked with SDO-shaped answers of §4.2: the server card S-DOC06 is not on
// the root yet (contract first).

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

// Built through DocumentSchema, as a real read is: a field the schema strips
// (admin_scope once was) can no longer reach a test that depends on it.
function target(over: Partial<ShareDialogTarget> = {}): ShareDialogTarget {
  const parsed = DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    organization_id: ORG,
    kind: "page",
    title: "Kế hoạch Q4",
    visibility: "workspace",
    revision: "7",
    my_level: "manage",
    ...over,
  });
  return {
    id: parsed.id,
    title: parsed.title,
    organization_id: parsed.organization_id,
    workspace_id: parsed.workspace_id,
    visibility: parsed.visibility as ShareDialogTarget["visibility"],
    revision: parsed.revision,
    owner_kind: (parsed.owner_kind ?? undefined) as ShareDialogTarget["owner_kind"],
    archived_at: parsed.archived_at ?? undefined,
    my_level: parsed.my_level as ShareDialogTarget["my_level"],
    admin_scope: parsed.admin_scope,
  };
}

/** u2 owns the document; u1 (the caller) and u3 are candidates. */
const accessPayload = (over: Record<string, unknown> = {}) => ({
  my_level: "manage",
  via: "member",
  acl_owner: { user_id: "u2", level: "manage", via: "member" },
  shares: [],
  links: [],
  ...over,
});

const orgMembers = {
  members: [
    { user_id: "u1", email: "an@acme.vn", display_name: "An", role: "admin", created_at: "" },
    { user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" },
    { user_id: "u3", email: "chi@acme.vn", display_name: "Chi", role: "member", created_at: "" },
    // An active org member outside this workspace is never offered.
    { user_id: "u5", email: "em@acme.vn", display_name: "Em", role: "member", created_at: "" },
  ],
  next_cursor: "",
};

const wsMembers = {
  members: [
    { workspace_id: WS, user_id: "u1", role: "admin", email: "an@acme.vn", display_name: "An" },
    { workspace_id: WS, user_id: "u2", role: "member", email: "binh@acme.vn", display_name: "Bình" },
    { workspace_id: WS, user_id: "u3", role: "member", email: "chi@acme.vn", display_name: "Chi" },
    // Still a workspace row but deactivated in the organization: absent from
    // the active org list, so never offered.
    { workspace_id: WS, user_id: "u4", role: "member", email: "dung@acme.vn", display_name: "Dũng" },
  ],
};

interface Options {
  access?: unknown;
  transfer?: (body: Record<string, unknown>) => Promise<unknown>;
}

function serve(over: Options = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
    if (path === "/api/v1/documents/d1/shares" && !opts?.method) {
      return Promise.resolve(over.access ?? accessPayload());
    }
    if (path === "/api/v1/documents/d1/owner" && opts?.method === "PUT") {
      if (over.transfer) return over.transfer(opts.body);
      return Promise.resolve({
        document_id: "d1",
        acl_owner_id: opts.body.user_id,
        previous_owner_id: "u2",
        previous_owner_share_id: "s9",
      });
    }
    if (path.startsWith("/api/v1/orgs/acme/members")) return Promise.resolve(orgMembers);
    if (path === `/api/v1/workspaces/${WS}/members`) return Promise.resolve(wsMembers);
    if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
    return Promise.resolve({});
  });
}

function renderDialog(doc: ShareDialogTarget = target()) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={doc} />
      </WorkspaceProvider>,
    ),
  );
}

const transferButton = () => screen.findByRole("button", { name: t("documents.share.owner.transfer_button") });

async function openTransfer() {
  fireEvent.click(await transferButton());
  return screen.findByRole("dialog", { name: t("documents.share.owner.transfer_title", { document: "Kế hoạch Q4" }) });
}

async function candidates(dialog: HTMLElement): Promise<string[]> {
  const input = within(dialog).getByRole("combobox", { name: t("documents.share.owner.new_owner_label") });
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  await screen.findAllByRole("option");
  // Let the candidate list settle (both member sources loaded).
  await waitFor(() => expect(screen.queryByRole("option", { name: /Chi/ })).not.toBeNull());
  return screen.getAllByRole("option").map((o) => o.textContent ?? "");
}

async function pickCandidate(dialog: HTMLElement, name: string) {
  await candidates(dialog);
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
}

const confirmButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: t("documents.share.owner.transfer_confirm") });

beforeEach(() => serve());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShareDialog owner transfer (DOC6-W01)", () => {
  it("offers Transfer ownership on the owner row to a manager", async () => {
    renderDialog();
    expect(await transferButton()).toBeTruthy();
  });

  it("hides it from an editor without admin_scope (no administer gate)", async () => {
    serve({ access: { my_level: "edit", via: "member" } });
    renderDialog(target({ my_level: "edit" }));
    await screen.findByText(t("documents.share.manage_only"));
    expect(screen.queryByRole("button", { name: t("documents.share.owner.transfer_button") })).toBeNull();
    expect(requestMock.mock.calls.some(([p]) => p === "/api/v1/documents/d1/shares")).toBe(false);
  });

  it("offers active workspace members only, never the current owner, and keeps Edit by default", async () => {
    renderDialog();
    const dialog = await openTransfer();
    const names = await candidates(dialog);
    expect(names.some((n) => n.includes("An"))).toBe(true);
    expect(names.some((n) => n.includes("Chi"))).toBe(true);
    // u2 owns it, u4 is deactivated, u5 is outside the workspace.
    expect(names.some((n) => n.includes("Bình"))).toBe(false);
    expect(names.some((n) => n.includes("Dũng"))).toBe(false);
    expect(names.some((n) => n.includes("Em"))).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const level = within(dialog).getByRole("combobox", {
      name: t("documents.share.owner.previous_level_label", { name: "Bình" }),
    });
    expect(level.textContent).toContain(t("documents.share.level_edit"));
  });

  it("waits for the server with an aria-disabled confirm, then reports the new owner", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    serve({ transfer: () => new Promise((r) => (resolve = r)) });
    renderDialog();
    const dialog = await openTransfer();
    expect(confirmButton(dialog).getAttribute("aria-disabled")).toBe("true");
    await pickCandidate(dialog, "Chi");
    expect(confirmButton(dialog).getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(confirmButton(dialog).getAttribute("aria-disabled")).toBe("true"));
    const put = requestMock.mock.calls.find(([p, o]) => p === "/api/v1/documents/d1/owner" && o?.method === "PUT");
    expect(put?.[1]?.body).toEqual({ user_id: "u3", previous_owner_level: "edit" });
    resolve({ document_id: "d1", acl_owner_id: "u3", previous_owner_id: "u2", previous_owner_share_id: "s9" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t("documents.share.owner.transfer_title", { document: "Kế hoạch Q4" }) })).toBeNull(),
    );
  });

  it("sends previous_owner_level none when the owner keeps nothing", async () => {
    renderDialog();
    const dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(within(dialog).getByRole("combobox", { name: t("documents.share.owner.previous_level_label", { name: "Bình" }) }));
    const none = await screen.findByRole("option", { name: t("documents.share.owner.previous_level_none") });
    fireEvent.pointerDown(none, { pointerType: "mouse" });
    fireEvent.pointerUp(none, { pointerType: "mouse" });
    fireEvent.click(none);
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    fireEvent.click(confirmButton(dialog));
    await waitFor(() =>
      expect(requestMock.mock.calls.find(([p, o]) => p === "/api/v1/documents/d1/owner" && o?.method === "PUT")?.[1]?.body).toEqual({
        user_id: "u3",
        previous_owner_level: "none",
      }),
    );
  });

  it("names the recipient on owner_target_not_member", async () => {
    serve({ transfer: () => Promise.reject(new ApiError("not a member", "owner_target_not_member", 422)) });
    renderDialog();
    const dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(confirmButton(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      t("documents.share.owner.target_not_member", { name: "Chi" }),
    );
  });

  it("keeps the owner row from collapsing at 390: it wraps, and the name truncates with a title", async () => {
    renderDialog();
    const name = await screen.findByTitle("Bình");
    expect(name).toHaveClass("truncate");
    const row = name.closest("li")!;
    expect(row).toHaveClass("flex-wrap");
    // The name block may shrink to nothing only after the button and level wrapped below it.
    expect(name.closest("span.flex")).toHaveClass("min-w-0", "flex-1");
    // A ghost button reads as muted text next to the level (F-11): the affordance is an outline.
    expect(within(row).getByRole("button", { name: t("documents.share.owner.transfer_button") })).toHaveClass(
      "border-input",
    );
  });

  it("answers a work-product 409 with a sentence of ours, never the server's text", async () => {
    serve({
      transfer: () => Promise.reject(new ApiError("Owned by a work product", "document_owned_by_work_product", 409)),
    });
    renderDialog();
    const dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(confirmButton(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(t("documents.share.owner.owned_by_work_product"));
  });

  it("answers a 500 with the generic sentence, never the raw server text", async () => {
    serve({ transfer: () => Promise.reject(new ApiError("boom", "internal", 500)) });
    renderDialog();
    const dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(confirmButton(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(t("documents.share.owner.failed"));
  });

  it("explains break_glass_required with the admin self-transfer sentence", async () => {
    serve({ transfer: () => Promise.reject(new ApiError("break glass", "break_glass_required", 403)) });
    renderDialog();
    const dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(confirmButton(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(t("documents.share.owner.self_transfer_error"));
  });

  it("pure admin (my_level '', admin_scope): note, transfer button, picker without self on restricted, no content read", async () => {
    serve({ access: accessPayload({ my_level: "", via: "", admin_scope: true }) });
    renderDialog(target({ my_level: "", admin_scope: true, visibility: "restricted" }));
    const note = await screen.findByText(t("documents.share.admin_scope_note"));
    const shareDialog = screen.getAllByRole("dialog")[0]!;
    expect(shareDialog.getAttribute("aria-describedby") ?? "").toContain(note.id);
    const dialog = await openTransfer();
    const names = await candidates(dialog);
    expect(names.some((n) => n.includes("Chi"))).toBe(true);
    expect(names.some((n) => n.includes("An"))).toBe(false);
    // The dialog never asks for the document body.
    expect(requestMock.mock.calls.some(([p]) => p === "/api/v1/documents/d1")).toBe(false);
  });

  it("shows Revoke and the add-share form to a manager and to a pure admin (DOC-05 canAdminister())", async () => {
    const shares = [{ id: "s1", principal_type: "user", principal_id: "u3", level: "view", active: true }];
    serve({ access: accessPayload({ shares }) });
    const view = renderDialog();
    expect(await screen.findByRole("button", { name: /Thu hồi/ })).toBeInTheDocument();
    view.unmount();

    serve({ access: accessPayload({ my_level: "", via: "", admin_scope: true, shares }) });
    renderDialog(target({ my_level: "", admin_scope: true }));
    await transferButton();
    expect(await screen.findByRole("button", { name: /Thu hồi/ })).toBeInTheDocument();
    expect(screen.getByText(t("documents.share.add_title"))).toBeInTheDocument();
  });

  it("break-glass admin (my_level view, admin_scope) on restricted keeps self out of the picker too", async () => {
    serve({ access: accessPayload({ my_level: "view", via: "break_glass", admin_scope: true }) });
    renderDialog(target({ my_level: "view", admin_scope: true, visibility: "restricted" }));
    const dialog = await openTransfer();
    const names = await candidates(dialog);
    expect(names.some((n) => n.includes("An"))).toBe(false);
  });

  it("returns focus to Transfer ownership when the dialog closes, and reopens from the defaults", async () => {
    renderDialog();
    const opener = await transferButton();
    let dialog = await openTransfer();
    await pickCandidate(dialog, "Chi");
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    dialog = await openTransfer();
    expect(confirmButton(dialog).getAttribute("aria-disabled")).toBe("true");
  });

  it("never offers a transfer on a work-product document", async () => {
    renderDialog(target({ owner_kind: "work_product" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: t("documents.share.owner.transfer_button") })).toBeNull();
  });
});
