// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeCapabilityEntry, SaveCoordinatorState } from "@uniwork/core/office";
import { leaveGuardAllows } from "@uniwork/views/navigation";
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

function renderHost(session: OfficeEditorSession<unknown>) {
  const props: OfficeEditorHostProps = {
    document: officeDocument,
    wsId: "workspace",
    readonly: false,
    session,
    capability,
    editorView: React.createElement("div", { contentEditable: true, role: "textbox", suppressContentEditableWarning: true }),
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

async function settle(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

describe("OfficeEditorHost composition", () => {
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
    expect(container.textContent).toContain("docx editing is not available yet.");
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
    await act(async () => { button("Save to UniWork").click(); });
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
    await act(async () => { button("Save to UniWork").click(); });
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
    await act(async () => { button("Save to UniWork").click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    await act(async () => { button("Stay").click(); });
    await expect(leave).resolves.toBe(false);
    rendered.root.unmount();
  });
});
