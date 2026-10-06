/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("finds text on the desktop host through the engine text layer and paints the hit (F-13)", async () => {
  const call = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:engine-call") {
      const request = payload as { operation: string; args: { geometry?: boolean } };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
      if (request.operation === "text") {
        const text = "Bao cao tong hop";
        const charBoxes = request.args.geometry ? text.split("").map((_c, index) => ({ x: index * 5, y: 20, width: 5, height: 8 })) : [];
        return { ok: true, operation: "text", pageCount: 1, pages: [{ page: 1, width: 100, height: 100, text, charBoxes }] };
      }
      return { ok: true, operation: "render", pngBase64: "iVBORw0KGgo=", width: 100, height: 100 };
    }
    return {};
  });
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "pdf", dataBase64: pdfBytes, checksum });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Report.pdf" onBack={() => undefined} />);
  await screen.findByTestId("pdf-editor", {}, { timeout: 10000 });

  fireEvent.click(await screen.findByTestId("pdf-chrome-find"));
  const input = await screen.findByLabelText("Tìm chữ trong PDF");
  fireEvent.change(input, { target: { value: "Bao cao" } });

  // The desktop host must reach the engine text layer and report a match.
  await waitFor(() => expect(call.mock.calls.some(([channel, payload]) => channel === "desktop:engine-call" && (payload as { operation: string }).operation === "text")).toBe(true), { timeout: 10000 });
  await waitFor(() => expect(screen.getByText("1 trên 1 kết quả")).toBeInTheDocument(), { timeout: 10000 });
});

it("lets the Forms panel leave its loading state on the desktop host (R18-2)", async () => {
  const call = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:engine-call") {
      const request = payload as { operation: string };
      if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
      return { ok: true, operation: "render", pngBase64: "iVBORw0KGgo=", width: 100, height: 100 };
    }
    return {};
  });
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "pdf", dataBase64: pdfBytes, checksum });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Report.pdf" onBack={() => undefined} />);
  await screen.findByTestId("pdf-editor", {}, { timeout: 10000 });

  fireEvent.click(await screen.findByTestId("pdf-chrome-tab-annotate"));
  fireEvent.click(await screen.findByRole("button", { name: "Điền biểu mẫu" }));
  expect(await screen.findByTestId("pdf-forms-panel")).toBeInTheDocument();
  // The desktop surface reads the form fields itself, so the panel never spins forever.
  await waitFor(() => expect(screen.queryByTestId("pdf-forms-loading")).toBeNull(), { timeout: 10000 });
  // The fixture bytes cannot be parsed: the panel shows the same error as on web (R-3).
  expect(await screen.findByText("Không đọc được các trường biểu mẫu của PDF này.")).toBeInTheDocument();
});

it("steps the desktop byte history from the quick-access buttons and Ctrl+Z / Ctrl+Y (G-1)", async () => {
  const editedBytes = Buffer.from("%PDF-1.7\n%edited\n").toString("base64");
  const probes: string[] = [];
  const call = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:engine-call") {
      const request = payload as { operation: string; args: { dataBase64: string } };
      if (request.operation === "open") { probes.push(request.args.dataBase64); return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] }; }
      if (request.operation === "edit") return { ok: true, operation: "edit", dataBase64: editedBytes };
      return { ok: true, operation: "render", pngBase64: "iVBORw0KGgo=", width: 100, height: 100 };
    }
    return {};
  });
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format: "pdf", dataBase64: pdfBytes, checksum });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Report.pdf" onBack={() => undefined} />);
  const editor = await screen.findByTestId("pdf-editor", {}, { timeout: 10000 });
  const undo = await screen.findByTestId("pdf-chrome-undo");
  const redo = await screen.findByTestId("pdf-chrome-redo");
  // Fresh document: nothing to step, so both stay aria-disabled and a Ctrl+Z
  // does not flag the document unsaved (UNI-954).
  expect(undo).toHaveAttribute("aria-disabled", "true");
  expect(redo).toHaveAttribute("aria-disabled", "true");
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  fireEvent.click(undo);
  expect(session.coordinator.getState().state).not.toBe("dirty");

  await act(async () => { await session.editor.submitEngineOperations!([{ op: "rotatePage", pageIndex: 0, degrees: 90 }]); });
  const lastProbe = () => probes[probes.length - 1];
  expect(lastProbe()).toBe(editedBytes);
  await waitFor(() => expect(undo).not.toHaveAttribute("aria-disabled"));
  expect(redo).toHaveAttribute("aria-disabled", "true");

  fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
  await waitFor(() => expect(lastProbe()).toBe(pdfBytes));
  fireEvent.keyDown(editor, { key: "y", ctrlKey: true });
  await waitFor(() => expect(lastProbe()).toBe(editedBytes));
  fireEvent.click(undo);
  await waitFor(() => expect(lastProbe()).toBe(pdfBytes));
  fireEvent.keyDown(editor, { key: "z", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(lastProbe()).toBe(editedBytes));
  fireEvent.click(undo);
  await waitFor(() => expect(lastProbe()).toBe(pdfBytes));
  fireEvent.click(redo);
  await waitFor(() => expect(lastProbe()).toBe(editedBytes));
  // Each step marked the coordinator dirty with the swapped bytes generation.
  expect(session.coordinator.getState().dirtyGeneration).toBe(session.editor.getDirtyGeneration());
});
