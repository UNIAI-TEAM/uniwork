/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenXlsxDocument } from "./xlsx-surface";
import type { RendererBridge } from "../app";
import type { DesktopXlsxSession } from "./xlsx-session";

// The shared editor is not under test here: only the surface's own markup.
vi.mock("@uniwork/views/office/xlsx", () => ({ XlsxEditor: () => <div data-testid="xlsx-editor-stub" /> }));

function textNodes(root: Node): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node.textContent ?? "");
  return out;
}

function mount(props: Partial<Parameters<typeof OpenXlsxDocument>[0]> = {}) {
  const bridge = { call: vi.fn(async () => ({ drafts: [] })), onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const coordinator = { getState: () => ({ state: "clean" }), subscribe: () => () => undefined, save: vi.fn() };
  const session = {
    documentKey: "doc-1", editor: {}, open: vi.fn(), coordinator, capability: "editable", canSave: true,
    listDrafts: vi.fn(async () => []), recoverDraft: vi.fn(), discardDraft: vi.fn(),
    rendererHostRef: { current: null, listeners: new Set() }, dispose: vi.fn(),
  } as unknown as DesktopXlsxSession;
  return render(<OpenXlsxDocument bridge={bridge} session={session} title="Book.xlsx" onBack={() => undefined} {...props} />);
}

it("renders no stray text beside the editor (visual r3 R3-9: a ';' leaked into the tab panel)", async () => {
  const bridge = { call: vi.fn(async () => ({ drafts: [] })), onSessionChanged: () => () => undefined } as unknown as RendererBridge;
  const coordinator = { getState: () => ({ state: "clean" }), subscribe: () => () => undefined, save: vi.fn() };
  const session = {
    documentKey: "doc-1",
    editor: {},
    open: vi.fn(),
    coordinator,
    capability: "editable",
    canSave: true,
    listDrafts: vi.fn(async () => []),
    recoverDraft: vi.fn(),
    discardDraft: vi.fn(),
    rendererHostRef: { current: null, listeners: new Set() },
    dispose: vi.fn(),
  } as unknown as DesktopXlsxSession;
  const { container } = render(<OpenXlsxDocument bridge={bridge} session={session} title="Book.xlsx" onBack={() => undefined} />);
  await screen.findByTestId("xlsx-editor-stub");
  expect(textNodes(container).map((text) => text.trim())).not.toContain(";");
});

it("keeps the locked AI entry out of the visible header: it lives in the document menu like the other formats", async () => {
  mount({ kind: "local", signedIn: false, onSignIn: () => undefined });
  await screen.findByTestId("xlsx-editor-stub");
  // Only the Back action is a visible header button next to the menu trigger.
  expect(document.querySelector("[data-ai-entry]")).toBeNull();
  const trigger = screen.getByRole("button", { name: i18n.t("office.ribbon.more") });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
  const group = await screen.findByRole("group", { name: i18n.t("officeDesktop.ai.entry") });
  expect(within(group).getByRole("button", { name: i18n.t("officeDesktop.ai.entry") })).toHaveAttribute("data-ai-entry", "locked");
});

it("has no document menu for a cloud document (nothing to put in it)", async () => {
  mount({ kind: "cloud" });
  await screen.findByTestId("xlsx-editor-stub");
  expect(document.querySelector("[data-office-document-menu]")).toBeNull();
  expect(document.querySelector("[data-ai-entry]")).toBeNull();
});

function readOnlyXlsxSession(): DesktopXlsxSession {
  const coordinator = { getState: () => ({ state: "readonly" }), subscribe: () => () => undefined, save: vi.fn() };
  return {
    documentKey: "doc-1", editor: {}, open: vi.fn(), coordinator, capability: "readonly", canSave: false,
    listDrafts: vi.fn(async () => []), recoverDraft: vi.fn(), discardDraft: vi.fn(),
    rendererHostRef: { current: null, listeners: new Set() }, dispose: vi.fn(),
  } as unknown as DesktopXlsxSession;
}
const xlsxBridge = () => ({ call: vi.fn(async () => ({ drafts: [] })), onSessionChanged: () => () => undefined } as unknown as RendererBridge);

it("a flag-off XLSX tab shows one neutral notice and no permission chip or alert (UIQ-1)", async () => {
  const { container } = render(<OpenXlsxDocument bridge={xlsxBridge()} session={readOnlyXlsxSession()} readOnlyReason="feature_off" title="Book.xlsx" onBack={() => undefined} />);
  await screen.findByTestId("xlsx-editor-stub");
  expect(container.querySelectorAll("[data-testid='office-feature-off']")).toHaveLength(1);
  expect(container.querySelector("[data-testid^='office-save-permission']")).toBeNull();
});

it("a read-only XLSX tab without the flag reason keeps the permission state and no feature-off notice", async () => {
  const { container } = render(<OpenXlsxDocument bridge={xlsxBridge()} session={readOnlyXlsxSession()} title="Book.xlsx" onBack={() => undefined} />);
  await screen.findByTestId("xlsx-editor-stub");
  expect(container.querySelector("[data-testid^='office-save-permission']")).not.toBeNull();
  expect(container.querySelector("[data-testid='office-feature-off']")).toBeNull();
});
