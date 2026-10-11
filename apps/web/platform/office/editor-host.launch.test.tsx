// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";

const getPublicConfig = vi.hoisted(() => vi.fn());
const createOfficeLaunchSession = vi.hoisted(() => vi.fn());
const launchOfficeDeepLink = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/api/endpoints/config", () => ({ getPublicConfig }));
vi.mock("@uniwork/core/api/endpoints/office-desktop", () => ({ getOfficeDesktopDownload: vi.fn(async () => null), downloadOfficeDesktopBundle: vi.fn() }));
vi.mock("@uniwork/core/api/endpoints/office-launch", () => ({ createOfficeLaunchSession }));
vi.mock("./desktop-handoff", () => ({ launchOfficeDeepLink }));

import { OfficeEditorHost } from "./editor-host";

initI18n();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capability = { format: "docx", operation: "edit", host: "web", engineBuild: "t", contractRevision: "t/1", status: "available", reason: null, fidelityWarnings: [] } as OfficeCapabilityEntry;
const state = { state: "saved", identity: {}, dirtyGeneration: 1, lastSavedGeneration: 1, activeIntentId: null, error: null };
const session = {
  coordinator: { getState: () => state, subscribe: () => () => undefined, markDirty: vi.fn(), setCapability: vi.fn(), save: vi.fn() },
  editor: { getDirtyGeneration: () => 1 },
  checkpoint: vi.fn(async () => true),
  recoverDraft: vi.fn(async () => ({ status: "missing" as const })),
  discardDraft: vi.fn(async () => true),
  clearMemory: vi.fn(async () => undefined),
  dispose: vi.fn(async () => undefined),
};
const doc = { id: "document", workspace_id: "ws", organization_id: "org", kind: "file", title: "Doc", revision: "1", current_version: 3 } as never;
const ticket = `ticket_${"a".repeat(40)}`;

const settle = () => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });

async function mount(props: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(OfficeEditorHost, { document: doc, wsId: "ws", readonly: false, session: session as never, capability, editorView: React.createElement("div"), ...props })); });
  await settle();
  return root;
}

const openButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Open in UniWork Office")!;

beforeEach(async () => {
  await setLocale("en");
  vi.clearAllMocks();
  document.body.innerHTML = "";
  getPublicConfig.mockResolvedValue({ office_installers: { dev: [], beta: [], stable: [] }, office_deployment_id: "default" });
  createOfficeLaunchSession.mockResolvedValue({ launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}` });
  launchOfficeDeepLink.mockResolvedValue("launched");
});

describe("OfficeEditorHost desktop launch (GOA9-r1-03)", () => {
  it("creates the launch session from the deployment id in the public config, with no host passing it", async () => {
    const root = await mount();
    await act(async () => { openButton().click(); });
    await settle();
    expect(createOfficeLaunchSession).toHaveBeenCalledTimes(1);
    expect(createOfficeLaunchSession).toHaveBeenCalledWith("document", expect.objectContaining({ operation: "edit", deployment_id: "default" }));
    // The current version is never named: a version makes the server mint a read-only session (GOA9-r1-08).
    expect(createOfficeLaunchSession.mock.calls[0]![1]).not.toHaveProperty("version");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    act(() => root.unmount());
  });

  it("keeps an explicit officeDeploymentId over the config", async () => {
    const root = await mount({ officeDeploymentId: "pinned" });
    await act(async () => { openButton().click(); });
    await settle();
    expect(createOfficeLaunchSession).toHaveBeenCalledWith("document", expect.objectContaining({ deployment_id: "pinned" }));
    act(() => root.unmount());
  });

  it("opens the installer prompt, not a failure, when no app answers the link", async () => {
    launchOfficeDeepLink.mockResolvedValue("not-installed");
    const root = await mount();
    await act(async () => { openButton().click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("stays closed when the config carries no deployment id", async () => {
    getPublicConfig.mockResolvedValue({ office_installers: { dev: [], beta: [], stable: [] } });
    const root = await mount();
    await act(async () => { openButton().click(); });
    await settle();
    expect(createOfficeLaunchSession).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not prepare");
    act(() => root.unmount());
  });
});
