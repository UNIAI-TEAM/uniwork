// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeCapabilityEntry, SaveCoordinatorState } from "@uniwork/core/office";
import { leaveGuardAllows } from "@uniwork/views/navigation";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "@uniwork/views/layout/header-actions-slot";
import { OfficeEditorHost, type OfficeEditorHostProps } from "./editor-host";
import type { OfficeEditorSession } from "./editor-host-core";

initI18n();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capability: OfficeCapabilityEntry = {
  format: "docx",
  operation: "edit",
  host: "web",
  engineBuild: "test",
  contractRevision: "test/1",
  status: "available",
  reason: null,
  fidelityWarnings: [],
};

const identity = {
  deploymentId: "deployment",
  accountId: "account",
  organizationId: "org",
  workspaceId: "workspace",
  documentId: "document",
  generation: 1,
  baseVersionId: "version-1",
  baseRevision: "1",
};

const officeDocument = {
  id: "document",
  workspace_id: "workspace",
  organization_id: "org",
  kind: "file",
  title: "Office document",
  revision: "1",
  current_version: 1,
  file: {
    file_id: "file",
    version_id: "version-1",
    version: 1,
    filename: "document.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 3,
    checksum_sha256: "sha256:file",
  },
} as never;

function makeSession() {
  let state: SaveCoordinatorState = {
    state: "dirty",
    identity,
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  let generation = 1;
  const listeners = new Set<(next: SaveCoordinatorState) => void>();
  const publish = (next: SaveCoordinatorState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };
  const coordinator = {
    getState: () => state,
    subscribe: (listener: (next: SaveCoordinatorState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    markDirty: (nextGeneration: number) => { generation = nextGeneration; publish({ ...state, state: "dirty", dirtyGeneration: nextGeneration }); },
    setCapability: (nextCapability: OfficeCapabilityEntry) => {
      publish({ ...state, state: nextCapability.status === "available" ? state.state : "readonly" });
    },
    save: vi.fn(async () => {
      publish({ ...state, state: "saved", lastSavedGeneration: generation, dirtyGeneration: generation });
      return { accepted: true, intentId: "intent", receipt: {} };
    }),
  };
  const setDirtyAfterSave = () => {
    generation += 1;
    publish({ ...state, state: "dirty", dirtyGeneration: generation });
  };
  const session = {
    coordinator,
    editor: { getDirtyGeneration: () => generation },
    checkpoint: vi.fn(async () => { publish({ ...state, state: "dirty", dirtyGeneration: generation }); return true; }),
    recoverDraft: vi.fn(async () => ({ status: "missing" as const })),
    discardDraft: vi.fn(async () => true),
    clearMemory: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as OfficeEditorSession<unknown>;
  return { session, coordinator, setDirtyAfterSave };
}

beforeEach(async () => {
  await setLocale("en");
});

function renderHost(session: OfficeEditorSession<unknown>, overrides: Partial<OfficeEditorHostProps> = {}) {
  const props: OfficeEditorHostProps = {
    document: officeDocument,
    wsId: "workspace",
    readonly: false,
    session,
    capability,
    editorView: React.createElement("div", { contentEditable: true, role: "textbox", suppressContentEditableWarning: true }),
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => { root = createRoot(container); root.render(React.createElement(OfficeEditorHost, props)); });
  return { container, root };
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found as HTMLButtonElement;
}

function dialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="dialog"]');
  const found = Array.from(dialog?.querySelectorAll("button") ?? []).find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`dialog button not found: ${label}`);
  return found as HTMLButtonElement;
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

describe("OfficeEditorHost composition", () => {
  it("renders a negotiated readonly editor without exposing or invoking Save", async () => {
    const { session, coordinator } = makeSession();
    const rendered = renderHost(session, {
      readonly: true,
      capability: { ...capability, status: "readonly", reason: "view permission" },
      editorView: React.createElement("div", { role: "grid", tabIndex: 0 }),
    });
    await settle();
    const grid = rendered.container.querySelector('[role="grid"]');
    expect(grid).toBeTruthy();
    expect(rendered.container.querySelector('[data-testid="office-host-unbound"]')).toBeNull();
    expect(rendered.container.querySelector('button[aria-label="Save to UniWork"]')).toBeNull();
    act(() => { grid!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })); });
    expect(coordinator.save).not.toHaveBeenCalled();
    expect(session.checkpoint).not.toHaveBeenCalled();
    rendered.root.unmount();
  });

  it.each(["unknown", "unavailable"] as const)("keeps a readonly %s capability closed", async (status) => {
    const { session, coordinator } = makeSession();
    const rendered = renderHost(session, { readonly: true, capability: { ...capability, status } });
    await settle();
    expect(rendered.container.querySelector('[role="textbox"]')).toBeNull();
    expect(rendered.container.querySelector('[data-testid="office-host-unbound"]')).toBeTruthy();
    expect(rendered.container.querySelector('button[aria-label="Save to UniWork"]')).toBeNull();
    expect(coordinator.save).not.toHaveBeenCalled();
    rendered.root.unmount();
  });

  it("does not expose a readonly capability as an editable editor", async () => {
    const { session } = makeSession();
    const rendered = renderHost(session, { readonly: false, capability: { ...capability, status: "readonly" } });
    await settle();
    expect(rendered.container.querySelector('[role="textbox"]')).toBeNull();
    expect(rendered.container.querySelector('button[aria-label="Save to UniWork"]')).toBeNull();
    rendered.root.unmount();
  });
  it("gates Save on an optional renderer readiness port and keeps dirty evidence", async () => {
    const { session } = makeSession();
    let ready = false;
    const listeners = new Set<() => void>();
    const viewReadiness = { getSnapshot: () => ready, subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } };
    const rendered = renderHost(session, { formatAdapter: { session, capability, editorView: React.createElement("div"), viewReadiness } });
    await settle();
    const saveButton = () => rendered.container.querySelector('button[aria-label="Save to UniWork"]');
    expect(saveButton()).toBeNull();
    expect(rendered.container.querySelector('[data-testid="office-save-not-sent"]')).toBeTruthy();
    act(() => { ready = true; listeners.forEach(listener => listener()); });
    expect(saveButton()).toBeTruthy();
    act(() => { ready = false; listeners.forEach(listener => listener()); });
    expect(saveButton()).toBeNull();
    expect(rendered.container.querySelector('[data-testid="office-save-not-sent"]')).toBeTruthy();
    rendered.root.unmount();
  });
  it("shows a localized unavailable state when the flag-on route has no 0Xb adapter", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OfficeEditorHost, {
        document: officeDocument,
        wsId: "workspace",
        readonly: false,
      }));
    });
    await settle();
    expect(container.textContent).toContain("This editor is unavailable");
    expect(container.textContent).toContain("DOCX editing is not available yet.");
    root.unmount();
  });

  it("warns on beforeunload without invoking a cloud write", async () => {
    const { session, coordinator } = makeSession();
    const rendered = renderHost(session);
    await settle();
    expect(rendered.container.querySelector('[role="textbox"]')).toBeTruthy();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(vi.mocked(coordinator.save)).not.toHaveBeenCalled();
    rendered.root.unmount();
  });

  it("keeps the leave promise open on failed Save and resolves after durable Keep", async () => {
    const { session, coordinator } = makeSession();
    vi.mocked(coordinator.save).mockImplementationOnce(async () => ({ accepted: false, reason: "error" } as never));
    const rendered = renderHost(session);
    const firstLeave = leaveGuardAllows("/next");
    await settle();
    await act(async () => { dialogButton("Save to UniWork").click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    expect(button("Keep draft on this device")).toBeTruthy();
    await act(async () => { button("Keep draft on this device").click(); });
    await expect(firstLeave).resolves.toBe(true);
    expect(vi.mocked(session.checkpoint)).toHaveBeenCalledTimes(1);
    rendered.root.unmount();
  });

  it("resolves the leave promise after Save is accepted and the coordinator is clean", async () => {
    const { session, coordinator } = makeSession();
    const rendered = renderHost(session);
    const leave = leaveGuardAllows("/next");
    await settle();
    await act(async () => { dialogButton("Save to UniWork").click(); });
    await expect(leave).resolves.toBe(true);
    expect(vi.mocked(coordinator.save)).toHaveBeenCalledWith("dialog");
    rendered.root.unmount();
  });

  it("keeps the leave promise open when durable Keep fails", async () => {
    const { session } = makeSession();
    vi.mocked(session.checkpoint).mockRejectedValueOnce(new Error("draft write failed"));
    const rendered = renderHost(session);
    const leave = leaveGuardAllows("/next");
    await settle();
    await act(async () => { button("Keep draft on this device").click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    await act(async () => { button("Stay").click(); });
    await expect(leave).resolves.toBe(false);
    rendered.root.unmount();
  });

  it("resolves a discard branch only after the durable delete succeeds", async () => {
    const { session } = makeSession();
    const rendered = renderHost(session);
    const leave = leaveGuardAllows("/next");
    await settle();
    await act(async () => { button("Discard changes").click(); });
    await expect(leave).resolves.toBe(true);
    expect(vi.mocked(session.discardDraft)).toHaveBeenCalledTimes(1);
    rendered.root.unmount();
  });

  it("does not leave after a receipt when a new edit makes the coordinator dirty", async () => {
    const { session, coordinator, setDirtyAfterSave } = makeSession();
    vi.mocked(coordinator.save).mockImplementationOnce(async () => {
      setDirtyAfterSave();
      return { accepted: true, intentId: "intent", receipt: {} };
    });
    const rendered = renderHost(session);
    const leave = leaveGuardAllows("/next");
    await settle();
    await act(async () => { dialogButton("Save to UniWork").click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    await act(async () => { button("Stay").click(); });
    await expect(leave).resolves.toBe(false);
    rendered.root.unmount();
  });
});

describe("OfficeEditorHost page header", () => {
  it("renders no header of its own and puts Save and the desktop action in the page slot", async () => {
    const { session } = makeSession();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(HeaderActionsSlotProvider, null,
        React.createElement("header", { "data-testid": "page-header" }, React.createElement(HeaderActionsSlot)),
        React.createElement(OfficeEditorHost, {
          document: officeDocument, wsId: "workspace", readonly: false, session, capability,
          editorView: React.createElement("div", { role: "textbox" }),
        })));
    });
    await settle();
    const shell = container.querySelector("[data-office-shell]")!;
    expect(shell.querySelector("header")).toBeNull();
    const pageHeader = container.querySelector('[data-testid="page-header"]')!;
    expect(pageHeader.querySelector('button[aria-label="Save to UniWork"]')?.textContent).toBe("Save");
    expect(pageHeader.querySelector('button[aria-label="Open in UniWork Office"]')).toBeTruthy();
    expect(container.querySelectorAll('button[aria-label="Save to UniWork"]')).toHaveLength(1);
    act(() => root.unmount());
  });
});

describe("OfficeEditorHost viewport bound", () => {
  // visual-r4 M-1: at 1440x900 the web editor card grew to ~1465px because the
  // host wrapper was an unbounded block div. It must be a definite-height flex
  // column so OfficeShell's flex-1 and docx-editor's h-full resolve and only
  // data-testid="docx-canvas" scrolls (ribbon + status bar stay pinned).
  it("gives the editor a bounded flex column so the canvas, not the page, scrolls", async () => {
    const { session } = makeSession();
    const rendered = renderHost(session);
    await settle();
    const wrapper = rendered.container.querySelector("[data-office-editor-host]")!;
    const classes = wrapper.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["flex", "h-full", "min-h-0", "flex-col", "overflow-hidden"]));
    // The shell is the flex child that absorbs the bound, not an auto-height block.
    const shell = rendered.container.querySelector("[data-office-shell]")!;
    expect(shell.className).toContain("flex-1");
    expect(shell.className).toContain("flex-col");
    rendered.root.unmount();
  });

  it("keeps a caller className without dropping the bounded wrapper classes", async () => {
    const { session } = makeSession();
    const rendered = renderHost(session, { className: "rounded-lg border" });
    await settle();
    const wrapper = rendered.container.querySelector("[data-office-editor-host]")!;
    expect(wrapper.className).toContain("rounded-lg");
    expect(wrapper.className).toContain("h-full");
    expect(wrapper.className).toContain("overflow-hidden");
    rendered.root.unmount();
  });
});
