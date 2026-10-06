/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";
import { createByteTestEditor } from "../../test/byte-editor";

const printTextDocument = vi.hoisted(() => vi.fn());
const createDesktopPrintPort = vi.hoisted(() => vi.fn(() => ({ print: vi.fn() })));
vi.mock("./text-print", async (importOriginal) => ({ ...(await importOriginal<typeof import("./text-print")>()), printTextDocument, createDesktopPrintPort }));

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = `sha256:${"b".repeat(64)}`;

function mount(format: "md" | "html" | "docx", source: string, canSave = true) {
  const call = vi.fn(async (channel: string) => channel === "desktop:draft-list" ? { drafts: [] } : {});
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

const printLabel = () => i18n.t("office.markdown.print.title");
const openMenu = () => { const trigger = document.querySelector("[data-office-document-menu]") as HTMLElement; fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" }); fireEvent.click(trigger); };

it.each([["md", "# Một\n"], ["html", "<p>Hai</p>"]] as const)("prints the current %s text through the main-process print channel", async (format, source) => {
  printTextDocument.mockResolvedValue({ outcome: "printed" });
  const { session } = mount(format, source);
  await screen.findByTestId(format === "md" ? "md-editor" : "html-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  await waitFor(() => expect(printTextDocument).toHaveBeenCalledWith(expect.objectContaining({ call: expect.any(Function) }), format, session.editor.getText?.(), `Doc.${format}`));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the action error when printing fails", async () => {
  printTextDocument.mockResolvedValue({ outcome: "failed", reason: "boom" });
  mount("md", "x");
  await screen.findByTestId("md-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("says a print is already open instead of the generic action error", async () => {
  printTextDocument.mockResolvedValue({ outcome: "failed", reason: "print_busy" });
  mount("md", "x");
  await screen.findByTestId("md-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  const notice = await screen.findByText(i18n.t("officeDesktop.library.printBusy"));
  // Same Alert primitive and tokens as the recovery notices, announced politely, not a bare line.
  const frame = notice.closest("[data-slot=\"alert\"]");
  expect(frame).not.toBeNull();
  expect(frame).toHaveAttribute("role", "status");
  expect(frame).toHaveAttribute("data-testid", "print-busy-notice");
  expect(frame).not.toHaveClass("text-destructive");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears the print-busy notice when the next print settles", async () => {
  printTextDocument.mockClear();
  printTextDocument.mockResolvedValueOnce({ outcome: "failed", reason: "print_busy" }).mockResolvedValueOnce({ outcome: "printed" });
  mount("md", "x");
  await screen.findByTestId("md-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  await screen.findByText(i18n.t("officeDesktop.library.printBusy"));
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  await waitFor(() => expect(printTextDocument).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(i18n.t("officeDesktop.library.printBusy"))).toBeNull());
});

it("offers no print item for a docx session", async () => {
  mount("docx", "hello");
  await waitFor(() => expect(document.querySelector("[data-office-document-menu]")).not.toBeNull());
  openMenu();
  await screen.findAllByRole("menuitem");
  expect(screen.queryByRole("menuitem", { name: printLabel() })).toBeNull();
});
