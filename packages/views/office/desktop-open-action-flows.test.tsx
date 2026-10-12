import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type MutableRefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DesktopOpenOutcome, OfficeSaveCoordinatorLike, OfficeSaveStateLike } from "./desktop-open-action";
import { DesktopOpenAction } from "./desktop-open-action";

// The hand-off flows beyond the happy path: the save-first dialog's refusals,
// the `app.open` request a frame makes through `requestRef`, the install
// prompt's data loading and "Open again", and a coordinator that changes state.

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

initI18n();

const ticket = `ticket_${"a".repeat(32)}`;
const session = { launch_ticket: ticket, launch_url: `uniwork-office://open?ticket=${ticket}`, expires_at: "2026-10-01T00:00:00Z", document_id: "doc-1", operation: "edit" as const, version: 2 };
const installers = [{ platform: "win32-x64" as const, channel: "stable" as const, url: "https://downloads.test/installer.exe", kind: ".exe" as const }];
const dirtyState: OfficeSaveStateLike = { state: "dirty", dirtyGeneration: 2, lastSavedGeneration: 1 };
const savedState: OfficeSaveStateLike = { state: "saved", dirtyGeneration: 2, lastSavedGeneration: 2 };

type Request = MutableRefObject<(() => Promise<DesktopOpenOutcome>) | null>;
const requestRef = (): Request => createRef<(() => Promise<DesktopOpenOutcome>) | null>() as Request;

beforeEach(async () => {
  await setLocale("en");
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Open in UniWork Office" }));

describe("save then open", () => {
  it("refuses a save the server did not confirm with a version", async () => {
    const createSession = vi.fn();
    const coordinator: OfficeSaveCoordinatorLike = { save: vi.fn(async () => ({ accepted: true })), getState: () => savedState };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={coordinator} createSession={createSession} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    expect(await screen.findByText("The save was not confirmed, so UniWork Office was not opened.")).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses a receipt version that is not a positive integer", async () => {
    const coordinator: OfficeSaveCoordinatorLike = { save: vi.fn(async () => ({ accepted: true, version: 0 })), getState: () => savedState };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={coordinator} createSession={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    expect(await screen.findByText("The save was not confirmed, so UniWork Office was not opened.")).toBeInTheDocument();
  });

  it("reports a save that throws and keeps the dialog usable", async () => {
    const coordinator: OfficeSaveCoordinatorLike = { save: vi.fn(async () => { throw new Error("offline"); }), getState: () => dirtyState };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={coordinator} createSession={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    expect(await screen.findByText("Save failed. Your changes remain in this editor.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save then open" })).toBeEnabled());
  });

  it("cannot save without a coordinator", async () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty createSession={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save then open" }));
    expect(await screen.findByText("Save failed. Your changes remain in this editor.")).toBeInTheDocument();
  });

  it("offers no 'open last saved' when there is no committed version", () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={null} dirty createSession={vi.fn()} />);
    open();
    expect(screen.getByRole("button", { name: "Open last saved version" })).toBeDisabled();
  });

  it("says the committed version is unavailable when a clean editor has none", () => {
    const createSession = vi.fn();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={null} createSession={createSession} />);
    open();
    expect(screen.getByText("The last committed version is unavailable.")).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("follows the coordinator: a clean editor becomes dirty and asks before opening", async () => {
    let state: OfficeSaveStateLike = savedState;
    let notify: (next: OfficeSaveStateLike) => void = () => undefined;
    const coordinator: OfficeSaveCoordinatorLike = {
      save: vi.fn(),
      getState: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    };
    const createSession = vi.fn(async () => session);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} saveCoordinator={coordinator} createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);
    act(() => {
      state = { state: "conflict", dirtyGeneration: 2, lastSavedGeneration: 2 };
      notify(state);
    });
    open();
    expect(await screen.findByRole("button", { name: "Save then open" })).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("hand-off failures", () => {
  it("shows the ticket error when minting the ticket throws", async () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => { throw new Error("500"); }} />);
    open();
    expect(await screen.findByText("UniWork Office could not prepare this document. Your editor and draft are unchanged.")).toBeInTheDocument();
  });

  it("asks for a read-only session when the caller may only view", async () => {
    const createSession = vi.fn(async () => session);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} operation="view" createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);
    open();
    await waitFor(() => expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({ operation: "view", return_hint: "office" })));
  });

  it("treats an app that cannot be reached without a launcher as not installed", async () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => session} />);
    open();
    expect(await screen.findByText("Get UniWork Office for desktop")).toBeInTheDocument();
  });

  it("says the ticket expired", async () => {
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => session} launch={vi.fn(async () => "expired" as const)} />);
    open();
    expect(await screen.findByText("That desktop handoff expired. Try opening it again.")).toBeInTheDocument();
  });
});

describe("install prompt", () => {
  it("loads installers and the platform hint, and falls back to an empty list when they fail", async () => {
    const loadInstallers = vi.fn(async () => { throw new Error("catalog down"); });
    const loadPlatformHint = vi.fn(async () => { throw new Error("hint down"); });
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={async () => session} launch={vi.fn(async () => "not-installed" as const)} loadInstallers={loadInstallers} loadPlatformHint={loadPlatformHint} />);
    open();
    expect(await screen.findByText("Install link unavailable")).toBeInTheDocument();
    expect(loadInstallers).toHaveBeenCalledOnce();
    expect(loadPlatformHint).toHaveBeenCalled();
  });

  it("asks the platform hint only once however often the menu opens", async () => {
    const loadPlatformHint = vi.fn(async () => ({ platform: "win32-x64" as const, confidence: "certain" as const }));
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} loadPlatformHint={loadPlatformHint} />);
    const trigger = screen.getByRole("button", { name: "UniWork Office options" });
    fireEvent.click(trigger);
    await screen.findByRole("menuitem", { name: "Download UniWork Office for Windows" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Open in UniWork Office" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
    fireEvent.click(trigger);
    await screen.findByRole("menuitem", { name: "Open in UniWork Office" });
    expect(loadPlatformHint).toHaveBeenCalledOnce();
  });

  it("closes the prompt and tries the hand-off again from Open again", async () => {
    const launch = vi.fn<(url: string) => Promise<"not-installed" | "launched">>().mockResolvedValueOnce("not-installed").mockResolvedValueOnce("launched");
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} installers={installers} createSession={async () => session} launch={launch} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Open again" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Get UniWork Office for desktop")).not.toBeInTheDocument());
  });

  it("opens the prompt from the Download item without minting a ticket", async () => {
    const createSession = vi.fn();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} createSession={createSession} installers={installers} />);
    fireEvent.click(screen.getByRole("button", { name: "UniWork Office options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download UniWork Office" }));
    expect(await screen.findByText("Get UniWork Office for desktop")).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("request from a frame (app.open)", () => {
  it("hands off the saved version and resolves launched", async () => {
    const ref = requestRef();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} requestRef={ref} createSession={async () => session} launch={vi.fn(async () => "launched" as const)} />);
    await expect(ref.current?.()).resolves.toBe("launched");
  });

  it("resolves installer when the app does not answer", async () => {
    const ref = requestRef();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} requestRef={ref} createSession={async () => session} launch={vi.fn(async () => "not-installed" as const)} />);
    await expect(ref.current?.()).resolves.toBe("installer");
  });

  it("resolves unavailable when there is no committed version", async () => {
    const ref = requestRef();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={null} requestRef={ref} createSession={vi.fn()} />);
    await expect(ref.current?.()).resolves.toBe("unavailable");
    expect(await screen.findByText("The last committed version is unavailable.")).toBeInTheDocument();
  });

  it("waits for the dirty dialog: cancel resolves unavailable, open saved resolves the hand-off", async () => {
    const ref = requestRef();
    const createSession = vi.fn(async () => session);
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty requestRef={ref} createSession={createSession} launch={vi.fn(async () => "launched" as const)} />);

    let pending = ref.current!();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(pending).resolves.toBe("unavailable");
    expect(createSession).not.toHaveBeenCalled();

    pending = ref.current!();
    fireEvent.click(await screen.findByRole("button", { name: "Open last saved version" }));
    await expect(pending).resolves.toBe("launched");
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("settles a pending request when the dialog is dismissed with Escape", async () => {
    const ref = requestRef();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty requestRef={ref} createSession={vi.fn()} />);
    const pending = ref.current!();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expect(pending).resolves.toBe("unavailable");
  });

  it("answers unavailable to a second request while one is waiting on the dialog", async () => {
    const ref = requestRef();
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty requestRef={ref} createSession={vi.fn()} />);
    const first = ref.current!();
    await screen.findByRole("dialog");
    await expect(ref.current!()).resolves.toBe("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(first).resolves.toBe("unavailable");
  });

  it("settles the request with the hand-off that follows Save then open", async () => {
    const ref = requestRef();
    const coordinator: OfficeSaveCoordinatorLike = { save: vi.fn(async () => ({ accepted: true, receipt: { version: 3 } })), getState: () => savedState };
    render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} dirty saveCoordinator={coordinator} requestRef={ref} createSession={async () => session} launch={vi.fn(async () => "launched" as const)} />);
    const pending = ref.current!();
    fireEvent.click(await screen.findByRole("button", { name: "Save then open" }));
    await expect(pending).resolves.toBe("launched");
  });

  it("clears the ref when the action unmounts", () => {
    const ref = requestRef();
    const { unmount } = render(<DesktopOpenAction documentId="doc-1" deploymentId="dep" savedVersion={2} requestRef={ref} />);
    expect(ref.current).toBeTypeOf("function");
    unmount();
    expect(ref.current).toBeNull();
  });
});
