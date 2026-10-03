import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { OfficeSaveCoordinatorLike } from "./office-shell";
import { DesktopOpenAction } from "./desktop-open-action";

initI18n();

const ticket = `ticket_${"a".repeat(32)}`;
const session = { launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}`, expires_at: "2026-10-01T00:00:00Z", document_id: "doc-1", operation: "edit" as const, version: 2 };

function coordinator(overrides: Partial<ReturnType<OfficeSaveCoordinatorLike["getState"]> & { save: OfficeSaveCoordinatorLike["save"] }> = {}): OfficeSaveCoordinatorLike {
  return {
    save: overrides.save ?? vi.fn(async () => ({ accepted: true, receipt: { version: 2 } })),
    getState: () => ({ state: "dirty", identity: {} as never, dirtyGeneration: 2, lastSavedGeneration: 1, activeIntentId: null, error: null, ...overrides }),
  };
}

beforeEach(async () => { await setLocale("en"); });

describe("DesktopOpenAction", () => {
  it("reuses the install prompt for Download without saving or minting a launch ticket", async () => {
    const createSession = vi.fn();
    const downloadInstaller = vi.fn(async () => undefined);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty createSession={createSession} downloadInstaller={downloadInstaller} loadInstallers={async () => ({ installers: [{ platform: "win32-x64", channel: "stable", url: "https://downloads.test/installer.exe", kind: ".exe" }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Download UniWork Office" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Download for Windows" }));
    await waitFor(() => expect(downloadInstaller).toHaveBeenCalledOnce());
    expect(createSession).not.toHaveBeenCalled();
  });
  it("shows a localized download failure while keeping the prompt available", async () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} downloadInstaller={async () => { throw new Error("network"); }} installers={[{ platform: "win32-x64", channel: "stable", url: "https://downloads.test/installer.exe", kind: ".exe" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Download UniWork Office" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download for Windows" }));
    await screen.findByText("Download failed. Please try again.");
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeDisabled();
  });
  it("opens the committed version without leaking document metadata", async () => {
    const createSession = vi.fn(async (_id: string, body: { version: number }) => { expect(body).toEqual(expect.objectContaining({ version: 2 })); expect(JSON.stringify(body)).not.toMatch(/title|path|token|bytes/i); return session; });
    const launch = vi.fn(async () => "launched" as const);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={createSession} launch={launch} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(launch).toHaveBeenCalledWith(`uniwork-office://open?ticket=${ticket}`);
  });

  it("offers save/open-saved/cancel for a dirty editor and waits for Save", async () => {
    let saved = false;
    const save = vi.fn(async () => { saved = true; return { accepted: true, receipt: { version: 3 } }; });
    const createSession = vi.fn(async (_id: string, body: { version: number }) => { expect(body.version).toBe(3); return { ...session, version: 3 }; });
    const fake: OfficeSaveCoordinatorLike = {
      save,
      getState: () => ({ state: saved ? "saved" : "dirty", identity: {} as never, dirtyGeneration: saved ? 2 : 2, lastSavedGeneration: saved ? 2 : 1, activeIntentId: null, error: null }),
    };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={fake} versionAfterSave={() => 3} createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    expect(screen.getByRole("button", { name: "Save then open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open last saved version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("dialog"));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
  });

  it("resolves a real save receipt version id before minting the ticket", async () => {
    const save = vi.fn(async () => ({ accepted: true, receipt: {
      intentId: "intent-1", idempotencyKey: "idem-1", documentId: "doc-1", versionId: "version-3",
      revision: "3", checksumSha256: "a", sizeBytes: 1, engineName: "engine", engineVersion: "1",
      contractVersion: "1", protocolVersion: "1",
    } }));
    const createSession = vi.fn(async (_id: string, body: { version: number }) => {
      expect(body.version).toBe(3);
      return { ...session, version: 3 };
    });
    const fake: OfficeSaveCoordinatorLike = {
      save,
      getState: () => ({ state: "saved", identity: {} as never, dirtyGeneration: 2, lastSavedGeneration: 2, activeIntentId: null, error: null }),
    };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={fake} versionAfterSave={async (outcome) => outcome.receipt?.versionId === "version-3" ? 3 : null} createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
  });

  it("opens the last committed version or cancels without saving", async () => {
    const createSession = vi.fn(async (_id: string, body: { version: number }) => ({ ...session, version: body.version }));
    const save = vi.fn(async () => ({ accepted: true, receipt: { version: 3 } }));
    const saveCoordinator = coordinator({ save });
    const { unmount } = render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={saveCoordinator} createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Open last saved version" }));
    await waitFor(() => expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({ version: 2 })));
    expect(save).not.toHaveBeenCalled();
    unmount();

    const secondSession = vi.fn();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={coordinator()} createSession={secondSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(secondSession).not.toHaveBeenCalled();
  });

  it("does not hand off after a failed Save", async () => {
    const createSession = vi.fn();
    const failed = coordinator({ save: vi.fn(async () => ({ accepted: false, reason: "error" })) });
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={failed} createSession={createSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    await waitFor(() => expect(screen.getByText("Save failed. Your changes remain in this editor.")).toBeInTheDocument());
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not hand off when N+1 remains dirty after Save", async () => {
    const newer = coordinator({ save: vi.fn(async () => ({ accepted: true, receipt: { version: 3 } })), dirtyGeneration: 3, lastSavedGeneration: 1, state: "dirty" });
    const createSession = vi.fn();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={newer} versionAfterSave={() => 3} createSession={createSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    expect(await screen.findByText("New unsaved changes remain. Save again before opening UniWork Office.")).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("keeps the editor intact and shows an install-unavailable prompt", async () => {
    const launch = vi.fn(async () => "not-installed" as const);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => session} launch={launch} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    expect(await screen.findByText("Get UniWork Office for desktop")).toBeInTheDocument();
    expect(screen.getByText("Install link unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Install UniWork Office" })).not.toBeInTheDocument();
  });

  it("keeps the editor intact when the ticket callback reports an error", async () => {
    const launch = vi.fn(async () => "error" as const);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => session} launch={launch} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    expect(await screen.findByText("The desktop handoff did not complete. Your editor and draft are unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
  });

  it("fails closed and never mints a ticket when no deployment id was advertised", async () => {
    const createSession = vi.fn();
    render(<DesktopOpenAction documentId="doc-1" deploymentId={undefined} savedVersion={2} createSession={createSession} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in UniWork Office" }));
    expect(await screen.findByText("UniWork Office could not prepare this document. Your editor and draft are unchanged.")).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });
});
