/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { App, type RendererBridge } from "./app";

// Hold the first cloud open while native file and deep-link requests arrive.
function harness() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let fileListener: ((event: { handle: string }) => void) | undefined;
  let launchListener: ((event: { documentId: string; operation: "view" | "edit" }) => void) | undefined;
  const checksum = `sha256:${"a".repeat(64)}`;
  const doc = (id: string) => ({ id, workspaceId: "ws", title: `${id}.docx`, kind: "file", format: "docx", version: 1, revision: "1", updatedAt: "2026-10-02T00:00:00Z", ownerKind: null, canEdit: true, downloadAvailable: true });
  const call = vi.fn(async (channel: string, payload: unknown) => {
    const request = payload as { documentId?: string; handle?: string };
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", deploymentId: "lane", accountId: "account" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "lane", name: "Server" }], accounts: [{ id: "account", name: "Account" }], organizations: [{ id: "org", name: "Org" }], workspaces: [{ id: "ws", name: "Workspace" }] };
    if (channel === "desktop:library-list") return { documents: [doc("doc-a")], nextCursor: null, engineAvailable: true };
    if (channel === "desktop:office-open") {
      if (request.documentId === "doc-a") await gate;
      return { document: doc(request.documentId!), dataBase64: "aGVsbG8=", checksum, filename: `${request.documentId}.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }
    if (channel === "desktop:file-open") return { opened: true, metadata: { handle: request.handle, name: `${request.handle}.docx`, byteLength: 5, modifiedAtMs: 1, checksum }, dataBase64: "aGVsbG8=" };
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:tabs-update") return { updated: true };
    return {};
  });
  const bridge: RendererBridge = {
    call: call as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
    onFileOpenRequested: (listener) => { fileListener = listener; return () => undefined; },
    onLaunchRequested: (listener) => { launchListener = listener; return () => undefined; },
  };
  render(<App bridge={bridge} />);
  return {
    call,
    release: async () => { await act(async () => { release(); await gate; }); },
    emitFile: (handle: string) => act(() => fileListener?.({ handle })),
    emitLaunch: (documentId: string) => act(() => launchListener?.({ documentId, operation: "edit" })),
  };
}

async function beginBusyOpen(h: ReturnType<typeof harness>) {
  await screen.findByText("doc-a.docx");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.library.open") }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:office-open", expect.objectContaining({ documentId: "doc-a" })));
  expect(screen.queryByRole("tab", { name: /doc-a/ })).toBeNull();
}

const fileB = "file_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const fileC = "file_cccccccccccccccccccccccccccccccc";

it("retains one native file-open request while a cloud open is busy", async () => {
  const h = harness();
  await beginBusyOpen(h);
  h.emitFile(fileB);
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:file-open")).toHaveLength(0);
  await h.release();
  await screen.findByRole("tab", { name: new RegExp(fileB) });
  expect(screen.getByRole("tab", { name: /doc-a/ })).toBeInTheDocument();
});

it("retains both native file-open requests received while a cloud open is busy", async () => {
  const h = harness();
  await beginBusyOpen(h);
  h.emitFile(fileB);
  h.emitFile(fileC);
  await h.release();
  await screen.findByRole("tab", { name: new RegExp(fileC) });
  const openedHandles = h.call.mock.calls.filter(([channel]) => channel === "desktop:file-open").map(([, payload]) => (payload as { handle: string }).handle);
  expect(openedHandles).toEqual([fileB, fileC]);
});

it("retains both native launch requests received while a cloud open is busy", async () => {
  const h = harness();
  await beginBusyOpen(h);
  h.emitLaunch("doc-b");
  h.emitLaunch("doc-c");
  await h.release();
  await screen.findByRole("tab", { name: /doc-c/ });
  const openedIds = h.call.mock.calls.filter(([channel]) => channel === "desktop:office-open").map(([, payload]) => (payload as { documentId: string }).documentId);
  expect(openedIds).toEqual(["doc-a", "doc-b", "doc-c"]);
});

it("preserves arrival order across mixed file and launch requests", async () => {
  const h = harness();
  await beginBusyOpen(h);
  h.emitFile(fileB);
  h.emitLaunch("doc-b");
  h.emitFile(fileC);
  await h.release();
  await screen.findByRole("tab", { name: new RegExp(fileC) });
  const opens = h.call.mock.calls.filter(([channel]) => channel === "desktop:office-open" || channel === "desktop:file-open").map(([, payload]) => {
    const request = payload as { documentId?: string; handle?: string };
    return request.documentId ?? request.handle;
  });
  expect(opens).toEqual(["doc-a", fileB, "doc-b", fileC]);
});
