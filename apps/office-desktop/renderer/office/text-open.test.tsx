/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import type { RendererBridge } from "../app";
import { createByteTestEditor } from "../../test/byte-editor";

const printTextDocument = vi.hoisted(() => vi.fn());
vi.mock("./text-print", () => ({ printTextDocument }));

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

it.each([["md", "# Một\n"], ["html", "<p>Hai</p>"]] as const)("prints the current %s text through the sandboxed print path", async (format, source) => {
  printTextDocument.mockResolvedValue({ outcome: "printed" });
  const { session } = mount(format, source);
  await screen.findByTestId(format === "md" ? "md-editor" : "html-editor", {}, { timeout: 15000 });
  openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: printLabel() }));
  await waitFor(() => expect(printTextDocument).toHaveBeenCalledWith(format, session.editor.getText?.(), `Doc.${format}`));
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

it("offers no print item for a docx session", async () => {
  mount("docx", "hello");
  await waitFor(() => expect(document.querySelector("[data-office-document-menu]")).not.toBeNull());
  openMenu();
  await screen.findAllByRole("menuitem");
  expect(screen.queryByRole("menuitem", { name: printLabel() })).toBeNull();
});
