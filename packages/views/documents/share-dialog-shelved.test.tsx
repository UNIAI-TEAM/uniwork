import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { UpdateDocumentAccessBody } from "@uniwork/core/api/endpoints/documents-sharing";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

// ARCHIVE-01 (UNI-1845) addendum §8 U-9 / Q-AR2 = a, test UI-AR6: the share
// dialog of a shelved document still lists and revokes access (and a level can
// only be LOWERED), but every way of granting more is aria-disabled (kept in
// the tab order) with one explanation line, and a click on it sends nothing.
// Structure: SH-W1 (UNI-1784) — the add flow is the candidate-picker batch
// section and each access row carries its own level select.

const { t } = initI18n();

const WS = "ws1";
const ORG = "o1";
const user: User = {
  id: "u1", email: "an@acme.vn", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = { id: WS, slug: "team", name: "Team", organization_id: ORG, organization_slug: "acme", organization_name: "Acme" };

function shelvedDoc(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: WS, organization_id: ORG, kind: "page", title: "Kế hoạch Q4", revision: "7",
    my_level: "manage", visibility: "workspace", updated_at: "2026-09-28T03:00:00Z",
    shelved_at: "2026-10-16T03:00:00Z", shelved_by: "u1", ...over,
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"], visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"], via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"], system_kind: parsed.system_kind as Document["system_kind"],
  };
}

// Bình holds "edit" so the row can exercise both directions: "Chỉnh sửa" stays
// current, "Chỉ xem" is a legal lowering, "Quản lý" an illegal raise. The home
// workspace sits at "view" so both of its higher levels are raises.
const access = {
  my_level: "manage", via: "member",
  acl_owner: { user_id: "u1", level: "manage", via: "member" },
  home_workspace: { workspace_id: WS, workspace_name: "Team", level: "view" },
  shares: [{
    id: "s1", principal_type: "user", principal_id: "u2", level: "edit", active: true, effective_level: "edit",
    effective_via: "share", granted_by: "u1", granted_by_kind: "human", created_at: "2026-09-27T03:00:00Z",
  }],
  links: [{ id: "l1", expires_at: "2026-12-04T03:00:00Z", view_count: 3, created_by: "u1", created_by_kind: "human", created_at: "2026-09-27T03:00:00Z" }],
};

function serve() {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(access);
    if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
      const body = opts.body as { dry_run?: boolean } | undefined;
      return Promise.resolve({
        batch_id: body?.dry_run ? "" : "01JBATCH1",
        dry_run: Boolean(body?.dry_run),
        results: [{ index: 0, status: "revoked" }],
        preview: { users: [], groups: [], warnings: [] },
      });
    }
    if (path.startsWith("/api/v1/documents/d1/links/") && opts?.method === "DELETE") return Promise.resolve({});
    if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
      return Promise.resolve({ items: [], next_cursor: "" });
    }
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      return Promise.resolve({ members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }], next_cursor: "" });
    }
    if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
    return Promise.resolve({});
  });
}

// The mocked request carries the real RequestInit: the access-write bodies are
// typed by the endpoint they go to (PUT /access → UpdateDocumentAccessBody).
const methodOf = (init: unknown): string =>
  init && typeof init === "object" && "method" in init && typeof init.method === "string" ? init.method : "GET";

const bodyOf = (init: unknown): UpdateDocumentAccessBody | undefined =>
  init && typeof init === "object" && "body" in init ? (init.body as UpdateDocumentAccessBody) : undefined;

const writes = () => requestMock.mock.calls.filter(([, init]) => methodOf(init) !== "GET");

const putCalls = () => requestMock.mock.calls.filter(([path, init]) => path === "/api/v1/documents/d1/access" && methodOf(init) === "PUT");

/** One macrotask of silence: React settles disabled-guard no-ops so a
 *  later `expect(writes())` sees whether anything fired. */
const settleTick = async () => {
  // No Promise.withResolvers under this lib target: one macrotask of silence
  // so React settles disabled-guard no-ops before expect(writes()).
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
};

function renderDialog(doc = shelvedDoc()) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={doc} />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(serve);
afterEach(() => vi.restoreAllMocks());

describe("UI-AR6 share dialog on a shelved document", () => {
  it("still lists the access and revokes a person, the home row and a link", async () => {
    const userEv = userEvent.setup();
    renderDialog();
    expect(await screen.findByText("Bình")).toBeInTheDocument();

    // Revoke a person's grant: PUT /access dry_run then commit, level null.
    await userEv.click(screen.getByRole("button", { name: /Thu hồi Bình/ }));
    const confirm = await screen.findByRole("button", { name: t("documents.share.confirm_accept") }).catch(() => null);
    if (confirm) await userEv.click(confirm);
    await waitFor(() => expect(putCalls().length).toBeGreaterThanOrEqual(1));
    for (const [, init] of putCalls()) {
      expect(bodyOf(init)?.items?.[0]?.level).toBeNull();
    }

    // Revoke the home workspace row (lowering it to nothing is allowed).
    const seenPuts = putCalls().length;
    await userEv.click(screen.getByRole("button", { name: /Thu hồi Workspace Team/ }));
    const confirmHome = await screen.findByRole("button", { name: t("documents.share.confirm_accept") }).catch(() => null);
    if (confirmHome) await userEv.click(confirmHome);
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(seenPuts));
    expect(bodyOf(putCalls()[seenPuts]![1])?.items?.[0]).toMatchObject({ principal_type: "workspace", level: null });

    // Revoke a public link.
    await userEv.click(screen.getByRole("button", { name: /^Thu hồi \d/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d1/links/l1", expect.objectContaining({ method: "DELETE" })));
  });

  it("lets a level be lowered but never raised on a person row", async () => {
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Bình");

    const rowSelect = screen.getByRole("combobox", { name: "Mức quyền Bình" });
    expect(rowSelect).not.toBeDisabled();
    await userEv.click(rowSelect);
    // "Quản lý" is a raise: the option exists (the list keeps full context) but cannot be picked.
    const manage = await screen.findByRole("option", { name: t("documents.share.level_manage") });
    expect(manage).toHaveAttribute("aria-disabled", "true");
    await userEv.click(manage);
    await settleTick();
    expect(putCalls()).toHaveLength(0);

    // "Chỉ xem" is a lowering and still writes (dry_run then commit or confirm).
    await userEv.keyboard("{Escape}");
    await userEv.click(rowSelect);
    await userEv.click(await screen.findByRole("option", { name: t("documents.share.level_view") }));
    const confirmLower = await screen.findByRole("button", { name: t("documents.share.confirm_accept") }).catch(() => null);
    if (confirmLower) await userEv.click(confirmLower);
    await waitFor(() => expect(putCalls().length).toBeGreaterThanOrEqual(1));
    expect(bodyOf(putCalls()[0]![1])?.items?.[0]?.level).toBe("view");
  });

  it("keeps the home row's raise options off (it cannot be turned on either)", async () => {
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Bình");

    const homeSelect = screen.getByRole("combobox", { name: "Mức quyền Team" });
    expect(homeSelect).not.toBeDisabled();
    await userEv.click(homeSelect);
    for (const key of ["level_comment", "level_edit"] as const) {
      expect(await screen.findByRole("option", { name: t(`documents.share.${key}`) })).toHaveAttribute("aria-disabled", "true");
    }
    // The home row's own ceiling (Q-S1) never lists "Quản lý" — every raise the
    // row could offer is off on a shelved document.
    expect(screen.queryByRole("option", { name: t("documents.share.level_manage") })).not.toBeInTheDocument();
    await userEv.click(screen.getByRole("option", { name: t("documents.share.level_edit") }));
    await settleTick();
    expect(putCalls()).toHaveLength(0);

    // Turning the row on when it is off goes through the add section: that is
    // a new grant, and the add input is disabled below.
    expect(screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") })).toBeDisabled();
  });

  it("explains itself and disables granting: batch submit, level pick, link create", async () => {
    renderDialog();
    await screen.findByText("Bình");
    const note = screen.getByText(t("documents.shelved_doc.share_note"));
    expect(note).toBeInTheDocument();

    // Grant batch: the submit button keeps its place in the tab order and says why it is off.
    const add = screen.getByRole("button", { name: t("documents.share.submit") });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).not.toBeDisabled();
    expect(add.getAttribute("aria-describedby")).toBe(note.id);
    // The candidate input and the common-level select cannot move.
    expect(screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: t("documents.share.level_label") })).toBeDisabled();
    // Link on: the create button is aria-disabled, the expiry field disabled.
    const link = screen.getByRole("button", { name: t("documents.share.link_create") });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).not.toBeDisabled();
    expect(link.getAttribute("aria-describedby")).toBe(note.id);
    expect(screen.getByLabelText(t("documents.share.link_expiry_label"))).toBeDisabled();

    fireEvent.click(add);
    fireEvent.click(link);
    await settleTick();
    expect(writes()).toHaveLength(0);
  });

  // F5 + F9: the server's shelve gate is the default of every document mutation (withDocumentMutation, addendum §3),
  // so handing the ACL owner on is refused like any grant: the button says why, opens nothing, wraps below the
  // owner name at 390px without clipping its label, and keeps its 44px coarse target.
  it("keeps Chuyển quyền sở hữu in the tab order but off, with the shelved note and unclipped 390 layout (F9)", async () => {
    renderDialog();
    await screen.findByText("Bình");
    const note = screen.getByText(t("documents.shelved_doc.share_note"));
    const transfer = screen.getByRole("button", { name: t("documents.share.owner.transfer_button") });
    expect(transfer).toHaveAttribute("aria-disabled", "true");
    expect(transfer).not.toBeDisabled();
    expect(transfer.getAttribute("aria-describedby")).toBe(note.id);
    expect(transfer).toHaveClass("max-w-full", "whitespace-normal", "pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    const ownerRow = transfer.closest("li")!;
    expect(ownerRow).toHaveClass("flex-wrap");
    expect(ownerRow.firstElementChild).toHaveClass("basis-full", "sm:basis-40", "min-w-0", "flex-1");
    expect(transfer.parentElement).toHaveClass("min-w-0", "max-w-full");
    const dialogs = screen.getAllByRole("dialog").length;
    fireEvent.click(transfer);
    await settleTick();
    expect(screen.getAllByRole("dialog")).toHaveLength(dialogs);
  });

  it("answers a 409 document_shelved share write with the shelved copy", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/shares" && !opts?.method) return Promise.resolve(access);
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(new ApiError("document is archived", "document_shelved", 409));
      }
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        return Promise.resolve({ members: [{ user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" }], next_cursor: "" });
      }
      if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
      return Promise.resolve({});
    });
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Bình");

    // Revoke is the one write left open; when the gate still refuses it, the
    // row-level error speaks the shelved sentence, not the raw envelope.
    await userEv.click(screen.getByRole("button", { name: /Thu hồi Bình/ }));
    expect(await screen.findByText(t("documents.shelved_doc.write_blocked"))).toBeInTheDocument();
  });

  it("leaves a live document's dialog as it was", async () => {
    renderDialog(shelvedDoc({ shelved_at: null, shelved_by: null }));
    await screen.findByText("Bình");
    expect(screen.queryByText(t("documents.shelved_doc.share_note"))).toBeNull();
    expect(screen.getByRole("button", { name: t("documents.share.link_create") })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("combobox", { name: t("documents.share.level_label") })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") })).not.toBeDisabled();
  });
});
