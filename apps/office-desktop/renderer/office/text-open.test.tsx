/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";
import { createByteTestEditor } from "../../test/byte-editor";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = `sha256:${"b".repeat(64)}`;

function mount(format: "md" | "html" | "docx", source: string, canSave = true, printAnswer: unknown = { outcome: "printed" }) {
  const call = vi.fn(async (channel: string) => channel === "desktop:draft-list" ? { drafts: [] } : channel === "desktop:print-document" ? printAnswer : {});
  const bridge = { call, onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { format, dataBase64: Buffer.from(source).toString("base64"), checksum, canSave }, format === "docx" ? { createEditor: createByteTestEditor } : undefined);
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title={`Doc.${format}`} kind="local" onBack={() => undefined} />);
  return { session, call };
}

it("mounts the shared Markdown editor for a .md session", async () => {
  mount("md", "# Tiêu đề\n");
  expect(await screen.findByTestId("md-editor", {}, { timeout: 15000 })).toBeInTheDocument();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
  expect(screen.queryByText("desktop_surface_unbound")).toBeNull();
});

it("mounts the shared HTML editor for a .html session", async () => {
  mount("html", "<p>Xin chào</p>");
  expect(await screen.findByTestId("html-editor", {}, { timeout: 15000 })).toBeInTheDocument();
  expect(screen.queryByTestId("office-editor-pending")).toBeNull();
});

it("shows the decoded text of a read-only .md instead of a bare capability notice", async () => {
  mount("md", "# Chỉ đọc\n", false);
  expect(await screen.findByTestId("readonly-text", {}, { timeout: 15000 })).toHaveTextContent("# Chỉ đọc");
});

const openMenu = () => { const trigger = document.querySelector("[data-office-document-menu]") as HTMLElement; fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" }); fireEvent.click(trigger); };
const printCalls = (call: ReturnType<typeof vi.fn>) => call.mock.calls.filter(([channel]) => channel === "desktop:print-document");

it.each([["md", "# Một\n"], ["html", "<p>Hai</p>"]] as const)("shows the %s editor's own Print entry once in the desktop menu and prints through main", async (format, source) => {
  const { call } = mount(format, source);
  await screen.findByTestId(format === "md" ? "md-editor" : "html-editor", {}, { timeout: 15000 });
  openMenu();
  await waitFor(() => expect(document.querySelectorAll("[data-header-menu-slot] [data-markdown-print]")).toHaveLength(1));
  // The shell no longer adds a Print item of its own: the view's is the only one.
  expect(document.querySelectorAll("[data-markdown-print]")).toHaveLength(1);
  fireEvent.click(document.querySelector("[data-markdown-print]") as HTMLElement);
  await waitFor(() => expect(printCalls(call)).toHaveLength(1));
  const payload = printCalls(call)[0]![1] as { title: string; html: string };
  expect(payload.title).toBe(`Doc.${format}`);
  const sent = new DOMParser().parseFromString(payload.html, "text/html");
  expect(sent.title).toBe(`Doc.${format}`);
  expect(sent.querySelector("script")).toBeNull();
  expect(sent.body.textContent).toContain(format === "md" ? "Một" : "Hai");
});

it("leaves print outcome notices to the view: no shell busy or error line", async () => {
  const { call } = mount("md", "x", true, { outcome: "failed", reason: "print_busy" });
  await screen.findByTestId("md-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await waitFor(() => document.querySelector("[data-markdown-print]") as HTMLElement));
  await waitFor(() => expect(printCalls(call)).toHaveLength(1));
  expect(screen.queryByTestId("print-busy-notice")).toBeNull();
  expect(screen.queryByText(i18n.t("officeDesktop.library.actionError"))).toBeNull();
});

it("offers no print item for a docx session without a view contribution", async () => {
  mount("docx", "hello");
  await waitFor(() => expect(document.querySelector("[data-office-document-menu]")).not.toBeNull());
  openMenu();
  await screen.findAllByRole("menuitem");
  expect(document.querySelector("[data-markdown-print]")).toBeNull();
});
