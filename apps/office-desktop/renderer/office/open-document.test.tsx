/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { expect, it } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";
import { createByteTestEditor } from "../../test/byte-editor";

const identity = { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "v1" };
const checksum = `sha256:${"a".repeat(64)}`;
const draft = { draftId: "doc-1:v1:1", identity: { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", base: { revision: "1", version: "v1" } }, generation: 2, checksum: `sha256:${"c".repeat(64)}`, byteLength: 5, updatedAt: 9 };
const olderDraft = { ...draft, draftId: "doc-1:v0:0", identity: { ...draft.identity, base: { revision: "0", version: "v0" } } };

function mount(handler: (channel: string, payload: unknown) => Promise<unknown>, active = true) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const bridge = {
    call: (async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return handler(channel, payload); }) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "docx", dataBase64: "aGVsbG8=", checksum }, { createEditor: createByteTestEditor });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Plan.docx" active={active} kind="cloud" signedIn onBack={() => undefined} />);
  return { calls, session };
}

it("offers a matching draft on the document screen and restores it", async () => {
  const { calls, session } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: "d29ybGQ=" };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-recover")).toBe(true));
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.library.draftRecovered"))).toBeInTheDocument());
  expect((await session.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("keeps an inactive tab's recovery offer hidden and its Save control disabled", async () => {
  const { calls } = mount(async (channel) => channel === "desktop:draft-list" ? { drafts: [draft] } : {}, false);
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-list")).toBe(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("office.save.action.save_to_cloud") })).toBeNull();
});

it("labels a conflicting draft and discards exactly that older-base row", async () => {
  const { calls } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [olderDraft] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: i18n.t("office.recovery.recover") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-discard")).toBe(true));
  expect(calls.find((call) => call.channel === "desktop:draft-discard")?.payload).toMatchObject({ draftId: olderDraft.draftId, generation: olderDraft.generation });
});

it("keeps a refused discard open instead of reporting a false success", async () => {
  mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [olderDraft] };
    if (channel === "desktop:draft-discard") throw Object.assign(new Error("draft operation refused"), { code: "storage_unavailable" });
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(screen.getByText(i18n.t("office.recovery.write_failed"))).toBeInTheDocument());
  expect(screen.getByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
});

it("renders the typed locked notice instead of a generic found-draft prompt", async () => {
  mount(async (channel) => {
    if (channel === "desktop:draft-list") throw Object.assign(new Error("draft operation refused"), { code: "draft_recovery_locked" });
    return {};
  });
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.getByText(i18n.t("office.recovery.locked"))).toBeInTheDocument();
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("shows the typed locked notice when recovery is refused by a locked store", async () => {
  const { calls } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "locked", metadata: draft, code: "draft_recovery_locked" };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-recover")).toBe(true));
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
  expect(screen.queryByText(i18n.t("office.recovery.write_failed"))).not.toBeInTheDocument();
});

it("shows no recovery prompt when the store holds no draft for this document", async () => {
  mount(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("office.ribbon.more") })).toBeInTheDocument());
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("exposes the local-mode AI entry as a labelled group and keeps it locked", async () => {
  const bridge = {
    call: (async (channel: string) => channel === "desktop:draft-list" ? { drafts: [] } : {}) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "docx", dataBase64: "aGVsbG8=", checksum }, { createEditor: createByteTestEditor });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Plan.docx" kind="local" signedIn={false} onSignIn={() => undefined} onBack={() => undefined} />);

  // The AI entry is reachable as a labelled group inside the document menu, not
  // a bare <div> child of role=menu.
  fireEvent.click(await screen.findByRole("button", { name: i18n.t("office.ribbon.more") }));
  const group = await screen.findByRole("group", { name: i18n.t("officeDesktop.ai.entry") });
  const entry = within(group).getByRole("button", { name: i18n.t("officeDesktop.ai.entry") });
  expect(entry).toHaveAttribute("data-ai-entry", "locked");

  // Behaviour is unchanged: opening it stays locked and only offers sign-in.
  fireEvent.click(entry);
  const prompt = await screen.findByRole("dialog");
  expect(within(prompt).getByText(i18n.t("officeDesktop.ai.title"))).toBeInTheDocument();
  expect(within(prompt).getByRole("button", { name: i18n.t("officeDesktop.ai.signIn") })).toBeInTheDocument();
});

it("keeps ONE primary Save in the header and moves Save As and back into the document menu", async () => {
  mount(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await waitFor(() => expect(screen.getByTestId("office-save-ready")).toBeInTheDocument());

  // The header cluster is Save + the overflow trigger only: no Save As or
  // back-to-library outline buttons sit beside it.
  expect(screen.queryByRole("button", { name: i18n.t("officeDesktop.library.saveAs") })).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("officeDesktop.library.back") })).toBeNull();
  expect(screen.getAllByRole("button", { name: i18n.t("office.shell.save_to_cloud") })).toHaveLength(1);

  // Save As and back-to-library stay reachable through the "..." menu.
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.ribbon.more") }));
  expect(await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.library.back") })).toBeInTheDocument();
});
