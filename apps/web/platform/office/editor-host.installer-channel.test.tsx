// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeCapabilityEntry } from "@uniwork/core/office";

const getPublicConfig = vi.hoisted(() => vi.fn());
const getOfficeDesktopDownload = vi.hoisted(() => vi.fn());
const downloadOfficeDesktopBundle = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/api/endpoints/config", () => ({ getPublicConfig }));
vi.mock("@uniwork/core/api/endpoints/office-desktop", () => ({ getOfficeDesktopDownload, downloadOfficeDesktopBundle }));

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
const doc = { id: "document", workspace_id: "ws", organization_id: "org", kind: "file", title: "Doc", revision: "1", current_version: 1 } as never;
const devInstaller = { platform: "win32-x64", channel: "dev", url: "https://dl.example/UniWork-Office.exe", kind: ".exe" };

const settle = () => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });

async function openDownloadDialog(props: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(OfficeEditorHost, { document: doc, wsId: "ws", readonly: false, session: session as never, capability, editorView: React.createElement("div"), ...props })); });
  await settle();
  const options = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "UniWork Office options")!;
  await act(async () => { options.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); options.click(); });
  await settle();
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((e) => e.textContent?.includes("Download UniWork Office"))!;
  await act(async () => { (item as HTMLElement).click(); });
  await settle();
  return root;
}

beforeEach(async () => {
  await setLocale("en");
  vi.clearAllMocks();
  getOfficeDesktopDownload.mockResolvedValue({ installers: [devInstaller], supported_platforms: ["win32-x64"] });
});

describe("OfficeEditorHost installer channel (UNI-1009)", () => {
  it("asks for the dev channel when only dev publishes installers", async () => {
    getPublicConfig.mockResolvedValue({ office_installers: { dev: [devInstaller], beta: [], stable: [] } });
    const root = await openDownloadDialog();
    expect(getOfficeDesktopDownload).toHaveBeenCalledWith("org", "dev");
    expect(getOfficeDesktopDownload).not.toHaveBeenCalledWith("org", "stable");
    act(() => root.unmount());
  });

  it("keeps an explicit officeChannel override", async () => {
    getPublicConfig.mockResolvedValue({ office_installers: { dev: [devInstaller], beta: [], stable: [] } });
    const root = await openDownloadDialog({ officeChannel: "beta" });
    expect(getOfficeDesktopDownload).toHaveBeenCalledWith("org", "beta");
    act(() => root.unmount());
  });

  it("falls back to stable (the no-installer state) when nothing is published", async () => {
    getPublicConfig.mockResolvedValue({ office_installers: { dev: [], beta: [], stable: [] } });
    const root = await openDownloadDialog();
    expect(getOfficeDesktopDownload).toHaveBeenCalledWith("org", "stable");
    act(() => root.unmount());
  });
});
