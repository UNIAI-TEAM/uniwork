/** @vitest-environment jsdom */
// UNI-957: the renderer keeps every open document mounted and only hides the
// inactive tab panels. Two editable DOCX tabs: Find acts on the visible one,
// never on the document kept in the hidden panel.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App, type RendererBridge } from "./app";
import { bytesChecksum, docxSource, installDocxGeometry } from "../test/docx-fixture";

installDocxGeometry();
const fixtureBase64 = Buffer.from(docxSource).toString("base64");
const HANDLES = ["file_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "file_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] as const;

it("keeps Find on the visible DOCX tab while another DOCX tab stays mounted", async () => {
  let fileOpen: ((event: { handle: string }) => void) | undefined;
  const call = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === "desktop:tabs-update") return { updated: true };
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "default", name: "Default" }], accounts: [{ id: "account-1", name: "Me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
    if (channel === "desktop:library-list") return { documents: [], nextCursor: null, engineAvailable: true };
    if (channel === "desktop:file-open") {
      const handle = (payload as { handle: string }).handle;
      const name = handle === HANDLES[0] ? "First.docx" : "Second.docx";
      return { opened: true, metadata: { handle, name, byteLength: docxSource.length, modifiedAtMs: 1, checksum: bytesChecksum(docxSource) }, dataBase64: fixtureBase64 };
    }
    return {};
  });
  const bridge: RendererBridge = {
    call: call as unknown as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
    onFileOpenRequested: (listener) => { fileOpen = listener; return () => { fileOpen = undefined; }; },
  };
  render(<App bridge={bridge} />);
  await screen.findByText("Chưa có tài liệu");
  act(() => fileOpen?.({ handle: HANDLES[0] }));
  await screen.findByTestId("docx-document-surface", undefined, { timeout: 10_000 });
  act(() => fileOpen?.({ handle: HANDLES[1] }));
  await screen.findByRole("tab", { name: /Second\.docx/ });
  await waitFor(() => expect(screen.getAllByTestId("docx-find-toggle")).toHaveLength(2), { timeout: 10_000 });

  const panels = [...document.querySelectorAll<HTMLElement>("[role='tabpanel'][id^='desktop-panel-']")].filter((panel) => panel.querySelector("[data-testid='docx-find-toggle']"));
  const visible = panels.find((panel) => !panel.hidden)!;
  const hidden = panels.find((panel) => panel.hidden)!;
  expect(visible).toBeDefined();
  expect(hidden).toBeDefined();

  // Find opens per document; Escape closes the visible one's and leaves a Find
  // still open in the hidden document alone.
  fireEvent.click(within(hidden).getByTestId("docx-find-toggle"));
  fireEvent.click(within(visible).getByTestId("docx-find-toggle"));
  await waitFor(() => expect(within(visible).getByTestId("docx-find-panel")).toBeInTheDocument());
  expect(within(hidden).getByTestId("docx-find-panel")).toBeInTheDocument();
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(within(visible).queryByTestId("docx-find-panel")).not.toBeInTheDocument();
  expect(within(hidden).getByTestId("docx-find-panel")).toBeInTheDocument();
  // Print targeting is pinned in packages/views (docx-tab-isolation, mixed-tab-isolation).
});
