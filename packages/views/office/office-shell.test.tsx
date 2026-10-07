import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createOfficeSaveCoordinator, type DraftAdapter, type EditorHandle, type OfficeIdentity, type StableSnapshot } from "@uniwork/core/office";
import { createFakeOfficeTransport } from "../../core/office/test-fakes";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "../layout/header-actions-slot";
import { OfficeShell, type OfficeSaveCoordinatorLike } from "./office-shell";
import { PRINT_PLATFORMS, pressPrintChord, stubPrintPlatform } from "../test/print-chord";
import { useOfficePrintShortcut } from "./print/shortcut";

initI18n();

function PrintingView({ run }: { run: () => void }) {
  useOfficePrintShortcut(run);
  return <div data-testid="canvas" />;
}

function coordinator(state: "ready" | "saving" | "saved" | "dirty"): OfficeSaveCoordinatorLike {
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
  it("does not advertise Ready or offer Save before the editor is ready", () => {
    const saveCoordinator = coordinator("ready");
    render(<OfficeShell title="Document" editor={<div />} saveCoordinator={saveCoordinator} />);
    expect(screen.queryByTestId("office-save-ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lưu vào UniWork" })).not.toBeInTheDocument();
  });

  it("preserves a real saving status when the editor is unavailable", () => {
    render(<OfficeShell title="Document" editor={<div />} saveCoordinator={coordinator("saving")} />);
    expect(screen.getByTestId("office-save-saving")).toBeInTheDocument();
  });

  it("omits the empty toolbar band and renders supplied toolbar content", () => {
    const view = render(<OfficeShell title="Document" editor={<div data-testid="canvas" />} />);
    const shell = view.container.querySelector("[data-office-shell]")!;
    expect(shell.children).toHaveLength(2);
    view.rerender(<OfficeShell title="Document" toolbar={<div data-testid="toolbar-content" />} editor={<div />} />);
    expect(screen.getByTestId("toolbar-content")).toBeInTheDocument();
    expect(shell.children).toHaveLength(3);
  });
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

  it("ignores a shortcut dispatched on the window, whose target is not a Node", () => {
    const saveCoordinator = coordinator("ready");
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} />);
    expect(() => fireEvent.keyDown(window, { key: "s", ctrlKey: true })).not.toThrow();
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });

  it("uses the scalar cloud-save translation for the toolbar control", () => {
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("ready")} />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toBeVisible();
    expect(save).toHaveAttribute("aria-label", "Lưu vào UniWork");
  });

  it("labels a local save receipt on the machine instead of the cloud", () => {
    const local = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("saved")} saveDestination="local" />);
    expect(screen.getByTestId("office-save-saved-local")).toHaveTextContent("Đã lưu trên máy");
    local.unmount();
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("saved")} />);
    expect(screen.getByTestId("office-save-saved-cloud")).toHaveTextContent("Đã lưu");
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

  it("renders the server snapshot as drawer and hydrates a wide viewport without a mismatch", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const tree = <OfficeShell title="Document" editor={<div />} panel={<div />} panelOpen />;
    const html = renderToString(tree);
    expect(html).toContain('data-panel-mode="drawer"');
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = hydrateRoot(container, tree);
    await waitFor(() => expect(container.querySelector("[data-panel-mode]")).toHaveAttribute("data-panel-mode", "static"));
    expect(errors).not.toHaveBeenCalled();
    root.unmount();
    container.remove();
    errors.mockRestore();
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

  it("labels the primary button Save and names the destination in its tooltip", () => {
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("ready")} />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveTextContent(/^Lưu$/);
    expect(save).toHaveAttribute("title", "Lưu vào UniWork");
    expect(screen.queryByText("Sẵn sàng lưu")).not.toBeInTheDocument();
    expect(screen.getByTestId("office-save-ready")).toHaveTextContent("Chưa có thay đổi");
  });

  it("renders the same Save whether saveQuietWhenClean is absent or false", () => {
    for (const state of ["ready", "dirty"] as const) {
      const absent = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator(state)} />);
      const absentHtml = screen.getByRole("button", { name: "Lưu vào UniWork" }).outerHTML;
      absent.unmount();
      // Defaulting to false must render exactly what the absent prop renders.
      const explicit = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator(state)} saveQuietWhenClean={false} />);
      expect(screen.getByRole("button", { name: "Lưu vào UniWork" }).outerHTML).toBe(absentHtml);
      explicit.unmount();
    }
  });

  it("quiets Save before any save state is known only when saveQuietWhenClean is set", () => {
    const onSave = vi.fn();
    const plain = render(<OfficeShell title="Document" editor={<div />} editorReady onSave={onSave} />);
    expect(screen.getByRole("button", { name: "Lưu vào UniWork" })).not.toHaveAttribute("aria-disabled");
    plain.unmount();
    render(<OfficeShell title="Document" editor={<div />} editorReady onSave={onSave} saveQuietWhenClean />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("quiets the header Save with aria-disabled and no save when clean and saveQuietWhenClean is set", () => {
    const saveCoordinator = coordinator("ready");
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} saveQuietWhenClean />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveAttribute("data-office-save");
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(save).not.toHaveClass("bg-primary");
    expect(save.tabIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(save);
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });

  it("keeps the primary Save and saves on click when there is something to save", () => {
    const saveCoordinator = coordinator("dirty");
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} saveQuietWhenClean />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveClass("bg-primary");
    expect(save).not.toHaveAttribute("aria-disabled");
    fireEvent.click(save);
    expect(saveCoordinator.save).toHaveBeenCalledWith("button");
  });

  it("names a local destination for a local save", () => {
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("ready")} saveDestination="local" />);
    expect(screen.getByRole("button", { name: "Lưu vào máy" })).toHaveTextContent(/^Lưu$/);
  });

  it("keeps Save in the tab order but inert and not primary while there is nothing to save", () => {
    const saveCoordinator = coordinator("ready");
    const { container } = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(save.className).not.toMatch(/\bbg-primary\b/);
    fireEvent.click(save);
    fireEvent.keyDown(container.querySelector("[data-office-shell]")!, { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });

  it("keeps Save inert and not primary right after a save, until an edit makes the document dirty", () => {
    const saveCoordinator = coordinator("saved");
    const { container } = render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(save.className).not.toMatch(/\bbg-primary\b/);
    fireEvent.click(save);
    fireEvent.keyDown(container.querySelector("[data-office-shell]")!, { key: "s", ctrlKey: true });
    expect(saveCoordinator.save).not.toHaveBeenCalled();
  });

  it("offers a primary, active Save once there is something to save", () => {
    const saveCoordinator = coordinator("dirty");
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={saveCoordinator} />);
    const save = screen.getByRole("button", { name: "Lưu vào UniWork" });
    expect(save).not.toHaveAttribute("aria-disabled");
    expect(save.className).toMatch(/\bbg-primary\b/);
    fireEvent.click(save);
    expect(saveCoordinator.save).toHaveBeenCalledWith("button");
  });

  it("keeps its own header with the cluster when it is not embedded", () => {
    const { container } = render(
      <HeaderActionsSlotProvider>
        <OfficeShell title="Report.docx" editor={<div />} editorReady saveCoordinator={coordinator("ready")} desktopAction={<button type="button">desktop</button>} />
        <HeaderActionsSlot />
      </HeaderActionsSlotProvider>,
    );
    const header = container.querySelector("[data-office-shell] header")!;
    expect(header).toHaveTextContent("Report.docx");
    const cluster = header.querySelector("[data-office-header-actions]")!;
    expect(cluster).toHaveClass("flex-nowrap");
    const order = [...cluster.querySelectorAll("button")].map((button) => button.textContent);
    expect(order).toEqual(["Lưu", "desktop"]);
    expect(container.querySelector("[data-header-actions-slot]")).toBeNull();
  });

  it("renders no header in embedded mode and hands the cluster to the page slot", async () => {
    const { container } = render(
      <HeaderActionsSlotProvider>
        <header data-testid="page-header"><HeaderActionsSlot /></header>
        <OfficeShell embedded title="Report.docx" editor={<div data-testid="canvas" />} editorReady saveCoordinator={coordinator("ready")} desktopAction={<button type="button">desktop</button>} />
      </HeaderActionsSlotProvider>,
    );
    const shell = container.querySelector("[data-office-shell]")!;
    expect(shell.querySelector("header")).toBeNull();
    expect(shell).not.toHaveTextContent("Report.docx");
    const pageHeader = screen.getByTestId("page-header");
    await waitFor(() => expect(pageHeader.querySelector("[data-office-header-actions]")).not.toBeNull());
    expect(within(pageHeader).getByRole("button", { name: "Lưu vào UniWork" })).toBeInTheDocument();
    expect(within(pageHeader).getByRole("button", { name: "desktop" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Lưu vào UniWork" })).toHaveLength(1);
  });

  it("hides the status text on phones so the header keeps title, Save and the menu", async () => {
    render(
      <HeaderActionsSlotProvider>
        <header data-testid="page-header"><HeaderActionsSlot /></header>
        <OfficeShell embedded title="Report.docx" editor={<div />} editorReady saveCoordinator={coordinator("saved")} />
      </HeaderActionsSlotProvider>,
    );
    const status = await screen.findByTestId("office-save-saved-cloud");
    expect(status).toHaveClass("hidden", "sm:flex");
    expect(status).toHaveAttribute("title", "Đã lưu lên UniWork");
  });

  it("falls back to its own header when embedded without a page slot", () => {
    const { container } = render(<OfficeShell embedded title="Report.docx" editor={<div />} editorReady saveCoordinator={coordinator("ready")} />);
    expect(container.querySelector("[data-office-shell] header")).toHaveTextContent("Report.docx");
    expect(screen.getByRole("button", { name: "Lưu vào UniWork" })).toBeInTheDocument();
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

  // The shell is shared by all six formats: only a failed save is the one-line
  // strip (9de552bb); every other in-shell banner keeps its card and margins.
  it.each(["permission", "conflict", "blocked", "readonly", "incompatible"] as const)(
    "keeps the %s banner a margined card in the shell",
    (saveStatus) => {
      const { container } = render(<OfficeShell title="Document" editor={<div />} editorReady saveStatus={saveStatus} />);
      const banner = container.querySelector("[data-office-shell] > [role=alert]");
      expect(banner).not.toBeNull();
      expect(banner!.className).toContain("mx-4 my-2 w-auto");
      expect(banner!.className).not.toContain("border-b");
      expect(banner).not.toHaveAttribute("data-testid", "office-save-error");
    },
  );

  it.each(["ready", "dirty", "saving", "saved"] as const)("renders no save banner for %s", (saveStatus) => {
    const { container } = render(<OfficeShell title="Document" editor={<div />} editorReady saveStatus={saveStatus} />);
    expect(container.querySelector("[data-office-shell] > [role=alert]")).toBeNull();
    expect(container.querySelector("[data-office-shell] > [role=status]")).toBeNull();
  });

  it("renders a failed save as the one-line strip without the card margins", () => {
    const { container } = render(<OfficeShell title="Document" editor={<div />} editorReady saveStatus="error" />);
    const strip = screen.getByTestId("office-save-error");
    expect(strip.parentElement).toBe(container.querySelector("[data-office-shell]"));
    expect(strip.className).toContain("border-b");
    expect(strip.className).not.toContain("mx-4");
    expect(strip.className).not.toContain("my-2");
  });

  it("routes Ctrl/Cmd+P from the page header to the open document's print, not the app window", () => {
    const run = vi.fn();
    render(
      <HeaderActionsSlotProvider>
        <header data-testid="page-header"><button type="button">menu</button><HeaderActionsSlot /></header>
        <OfficeShell embedded title="Report.docx" editor={<PrintingView run={run} />} />
      </HeaderActionsSlotProvider>,
    );
    const handled = pressPrintChord(screen.getByRole("button", { name: "menu" }));
    expect(handled).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(PRINT_PLATFORMS)("prints only the active document when a hidden tab's shell is also mounted (%s)", (platform) => {
    const restore = stubPrintPlatform(platform);
    const hiddenRun = vi.fn();
    const activeRun = vi.fn();
    render(<>
      <div hidden inert><OfficeShell title="Old.xlsx" editor={<PrintingView run={hiddenRun} />} /></div>
      <OfficeShell title="Open.pptx" editor={<PrintingView run={activeRun} />} />
    </>);
    try {
      pressPrintChord(document.body);
      expect(activeRun).toHaveBeenCalledTimes(1);
      expect(hiddenRun).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("leaves Ctrl+P to the platform when the open document cannot print", () => {
    render(<OfficeShell title="Document" editor={<div />} />);
    expect(pressPrintChord(document.body)).toBe(true);
  });

  it("renders the editor edge to edge", () => {
    render(<OfficeShell title="Document" editor={<div data-testid="ed" />} />);
    expect(screen.getByTestId("ed").closest("main")!.className).not.toMatch(/(^|\s)p-[0-9]/);
  });
});
