import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { createOfficeSaveCoordinator, type DraftAdapter, type EditorHandle, type OfficeIdentity, type StableSnapshot } from "@uniwork/core/office";
import { createFakeOfficeTransport } from "../../core/office/test-fakes";
import { HeaderActionsSlot, HeaderActionsSlotProvider } from "../layout/header-actions-slot";
import { OfficeShell, type OfficeSaveCoordinatorLike } from "./office-shell";

initI18n();

function coordinator(state: "ready" | "saving" | "saved"): OfficeSaveCoordinatorLike {
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

  it("names a local destination for a local save", () => {
    render(<OfficeShell title="Document" editor={<div />} editorReady saveCoordinator={coordinator("ready")} saveDestination="local" />);
    expect(screen.getByRole("button", { name: "Lưu vào máy" })).toHaveTextContent(/^Lưu$/);
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

  it("renders the editor edge to edge", () => {
    render(<OfficeShell title="Document" editor={<div data-testid="ed" />} />);
    expect(screen.getByTestId("ed").closest("main")!.className).not.toMatch(/(^|\s)p-[0-9]/);
  });
});
