/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { expect, it } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";

const identity = { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "v1" };
const checksum = `sha256:${"a".repeat(64)}`;
const draft = { draftId: "doc-1:v1:1", identity: { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", base: { revision: "1", version: "v1" } }, generation: 2, checksum: `sha256:${"c".repeat(64)}`, byteLength: 5, updatedAt: 9 };

function mount(handler: (channel: string) => Promise<unknown>) {
  const calls: string[] = [];
  const bridge = { call: (async (channel: string) => { calls.push(channel); return handler(channel); }) as unknown as RendererBridge["call"] };
  const session = createByteDocumentSession(bridge, identity, { dataBase64: "aGVsbG8=", checksum });
  const view = render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Plan.docx" onBack={() => undefined} />);
  return { calls, session, view };
}

it("offers a matching draft on the document screen and restores it", async () => {
  const { calls, session } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: "d29ybGQ=" };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(calls).toContain("desktop:draft-recover"));
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.library.draftRecovered"))).toBeInTheDocument());
  expect((await session.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("labels a conflicting draft and can discard it", async () => {
  const conflicting = { ...draft, identity: { ...draft.identity, base: { revision: "9", version: "v9" } } };
  const { calls } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [conflicting] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: i18n.t("office.recovery.recover") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(calls).toContain("desktop:draft-discard"));
});

it("shows no recovery prompt when the store holds no draft for this document", async () => {
  mount(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("officeDesktop.library.back") })).toBeInTheDocument());
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});
