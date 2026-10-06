/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";
import { bytesChecksum, docxIdentity as identity, docxSource as source, installDocxGeometry } from "../../test/docx-fixture";

installDocxGeometry();
const checksum = bytesChecksum(source);

function mount() {
  const call = vi.fn(async (channel: string) => channel === "desktop:draft-list" ? { drafts: [] } : {});
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "docx", data: Uint8Array.from(Buffer.from(source)), checksum });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Fixture.docx" onBack={() => undefined} />);
  return { session, call };
}

it("mounts the shared DOCX rendering surface with editable document content", async () => {
  const { session } = mount();
  expect(await screen.findByTestId("docx-document-surface", {}, { timeout: 10000 })).toBeInTheDocument();
  expect(document.querySelector('.ProseMirror[contenteditable="true"]')).not.toBeNull();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
  expect(session.editor.renderSurface).toBeTypeOf("function");
});

it("does not create an intent or write when Save is requested without an edit", async () => {
  const { session, call } = mount();
  await screen.findByTestId("docx-editor");
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "clean" });
  expect(call.mock.calls.some(([channel]) => channel === "desktop:office-save")).toBe(false);
});

it("marks real toolbar edits dirty without writing cloud or original local bytes", async () => {
  const { session, call } = mount();
  await screen.findByTestId("docx-document-surface");
  act(() => session.editor.commands?.setHeading(2));
  await waitFor(() => expect(session.coordinator.getState().state).toBe("dirty"));
  expect(session.editor.getDirtyGeneration()).toBeGreaterThan(0);
  expect(call.mock.calls.some(([channel]) => /save|checkpoint/.test(channel))).toBe(false);
});
