/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = `sha256:${"a".repeat(64)}`;
const pdfBytes = Buffer.from("%PDF-1.7\n").toString("base64");

/** A PDF session whose engine calls are answered by the desktop host lane;
 * this proves the format-agnostic session mounts the PDF slot end to end. */
function mount() {
  const call = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:engine-call") {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 2 } };
      return { ok: true, operation: "edit", dataBase64: pdfBytes };
    }
    return {};
  });
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "pdf", dataBase64: pdfBytes, checksum });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Report.pdf" onBack={() => undefined} />);
  return { session, call };
}

it("mounts the shared PDF editor for a .pdf session", async () => {
  mount();
  expect(await screen.findByTestId("pdf-editor", {}, { timeout: 10000 })).toBeInTheDocument();
  expect(await screen.findByTestId("pdf-canvas", {}, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
  expect(screen.queryByTestId("docx-document-surface")).toBeNull();
});

it("opens the PDF through the validated engine channel, not a renderer engine", async () => {
  const { call } = mount();
  await screen.findByTestId("pdf-editor", {}, { timeout: 10000 });
  await waitFor(() => expect(call.mock.calls.some(([channel, payload]) => channel === "desktop:engine-call" && (payload as { operation: string }).operation === "open")).toBe(true));
});
