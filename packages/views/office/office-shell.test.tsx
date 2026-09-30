import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createOfficeSaveCoordinator, type DraftAdapter, type EditorHandle, type OfficeIdentity, type StableSnapshot } from "@uniwork/core/office";
import { createFakeOfficeTransport } from "../../core/office/test-fakes";
import { OfficeShell, type OfficeSaveCoordinatorLike } from "./office-shell";

initI18n();

function coordinator(state: "ready" | "saving"): OfficeSaveCoordinatorLike {
  return {
    save: vi.fn(async () => ({ accepted: true })),
    getState: () => ({
      state,
      identity: {} as never,
      dirtyGeneration: 1,
      lastSavedGeneration: 0,
      activeIntentId: state === "saving" ? "intent-1" : null,
      error: null,
    }),
  };
}

describe("OfficeShell", () => {
  it("uses one coordinator guard for button and shortcut while saving", () => {
    const saveCoordinator = coordinator("saving");
    const { container } = render(
      <OfficeShell title="Document" editor={<div data-testid="canvas" />} editorReady saveCoordinator={saveCoordinator} />,
    );
    const disabledButtons = screen.getAllByRole("button").filter((button) => button.hasAttribute("disabled"));
    expect(disabledButtons).toHaveLength(1);
    const save = disabledButtons[0]!;
    expect(save).toBeDisabled();
    fireEvent.click(save);
    fireEvent.keyDown(container.querySelector("[data-office-shell]")!, { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("uses the scalar cloud-save translation for the toolbar control", () => {
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("ready")} />);
    const save = screen.getByRole("button", { name: "Lưu lên UniWork" });
    expect(save).toBeVisible();
    expect(save).toHaveAttribute("aria-label", "Lưu lên UniWork");
  });

  it("keeps the real G3-01 coordinator fake single-flight at the views seam", async () => {
    let releaseSnapshot: (() => void) | undefined;
    let releaseCommit: (() => void) | undefined;
    const identity: OfficeIdentity = {
      deploymentId: "dep-1",
      accountId: "acct-1",
      organizationId: "org-1",
      workspaceId: "ws-1",
      documentId: "doc-1",
      generation: 1,
      baseVersionId: "version-1",
      baseRevision: "1",
    };
    const editor: EditorHandle<{ text: string }> = {
      format: "md",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(() => new Promise<StableSnapshot<{ text: string }>>((resolve) => {
        releaseSnapshot = () => resolve({ generation: 1, fingerprint: "fp-1", value: { text: "draft" } });
      })),
      dispose: vi.fn(),
    };
    const draft: DraftAdapter<{ text: string }> = {
      checkpoint: vi.fn(async () => undefined),
      recover: vi.fn(async () => null),
      discard: vi.fn(async () => undefined),
      persistIntent: vi.fn(async () => undefined),
      loadIntent: vi.fn(async () => null),
      clearIntent: vi.fn(async () => undefined),
    };
    const transport = createFakeOfficeTransport<{ text: string }>();
    transport.commit = vi.fn(({ intent }) => new Promise((resolve) => {
      releaseCommit = () => resolve({
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        documentId: intent.identity.documentId,
        versionId: "version-2",
        revision: "2",
        checksumSha256: "sha",
        sizeBytes: 1,
        engineName: "fake",
        engineVersion: "1",
        contractVersion: "1",
        protocolVersion: "1",
      });
    }));
    const coordinator = createOfficeSaveCoordinator({ identity, editor, draft, transport, backoffMs: [0] });
    coordinator.markDirty(1);
    const first = coordinator.save("button");
    releaseSnapshot?.();
    await waitFor(() => expect(coordinator.getState().state).toBe("saving"));
    const shell = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator} />);
    const save = screen.getAllByRole("button").find((button) => button.hasAttribute("disabled"))!;
    expect(save).toBeDisabled();
    fireEvent.keyDown(shell.container.querySelector("[data-office-shell]")!, { key: "s", ctrlKey: true });
    expect(await coordinator.save("shortcut")).toEqual({ accepted: false, reason: "saving" });
    await waitFor(() => expect(transport.commit).toHaveBeenCalledTimes(1));
    releaseCommit?.();
    await first;
  });

  it("renders a single panel that becomes a drawer at narrow widths", () => {
    render(
      <OfficeShell
        title="Document"
        editor={<div />}
        panel={<div data-testid="panel-content" />}
        panelOpen
        panelLabel="Details"
      />,
    );
    const panel = screen.getByTestId("panel-content").closest("[data-office-panel]");
    expect(panel).toHaveAttribute("data-panel-mode");
    expect(screen.getAllByTestId("panel-content")).toHaveLength(1);
  });

  it.each([
    [360, "drawer"],
    [375, "drawer"],
    [768, "drawer"],
    [1280, "static"],
  ] as const)("reports the responsive panel mode at %s px", (width, mode) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: width >= 1024,
      media: "(min-width: 1024px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })));
    const { unmount } = render(
      <OfficeShell title="Document" editor={<div />} panel={<div />} panelOpen />,
    );
    expect(screen.getByRole("complementary")).toHaveAttribute("data-panel-mode", mode);
    unmount();
    vi.unstubAllGlobals();
  });

  it("keeps the shell theme observable for light and dark token surfaces", () => {
    const root = document.documentElement;
    root.classList.remove("dark");
    const view = render(<OfficeShell title="Document" editor={<div />} />);
    expect(view.container.querySelector("[data-office-shell]")).toHaveAttribute("data-theme", "light");
    view.unmount();
    root.classList.add("dark");
    const darkView = render(<OfficeShell title="Document" editor={<div />} />);
    expect(darkView.container.querySelector("[data-office-shell]")).toHaveAttribute("data-theme", "dark");
    darkView.unmount();
    root.classList.remove("dark");
  });

  it("connects tabs to one panel and supports roving keyboard focus", () => {
    const onTabChange = vi.fn();
    render(
      <OfficeShell
        title="Document"
        editor={<div />}
        panelOpen
        activeTab="overview"
        onTabChange={onTabChange}
        tabs={[
          { id: "overview", label: "Overview", panel: <div>Overview panel</div> },
          { id: "activity", label: "Activity", panel: <div>Activity panel</div> },
        ]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(tabs[0]).toHaveAttribute("aria-controls", "office-tab-overview-panel");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "office-tab-overview");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenCalledWith("activity");
    expect(tabs[1]).toHaveFocus();
  });

  it("does not expose Save until the editor has opened successfully", () => {
    render(
      <OfficeShell
        title="Document"
        editor={<div role="alert">The file could not be opened</div>}
        editorReady={false}
        saveCoordinator={coordinator("ready")}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
