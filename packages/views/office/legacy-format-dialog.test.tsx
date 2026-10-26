import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { LegacyFormatDialog, type LegacyFormatDialogProps } from "./legacy-format-dialog";

const { t } = initI18n();

const ticket = `ticket_${"a".repeat(32)}`;
const session = {
  launch_ticket: ticket,
  launch_url: `uniwork-office://open?ticket=${ticket}`,
  expires_at: "2026-10-26T00:00:00Z",
  document_id: "doc-1",
  operation: "edit" as const,
  version: 2,
};

function renderDialog(overrides: Partial<LegacyFormatDialogProps> = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const createSession = vi.fn(async () => session);
  const launch = vi.fn(async () => "launched" as const);
  const loadInstallers = vi.fn(async () => ({
    installers: [
      {
        platform: "win32-x64" as const,
        channel: "stable" as const,
        url: "https://downloads.test/UniWork-Office.exe",
        kind: ".exe",
      },
    ],
  }));
  const loadPlatformHint = vi.fn(async () => ({
    platform: "win32-x64" as const,
    confidence: "certain" as const,
  }));

  render(
    <LegacyFormatDialog
      open
      onOpenChange={onOpenChange}
      documentId="doc-1"
      savedVersion={2}
      desktopOpen={{
        deploymentId: "dep-1",
        channel: "stable",
        savedVersion: 2,
        createSession,
        launch,
        loadInstallers,
        loadPlatformHint,
      }}
      {...overrides}
    />,
  );
  return { onOpenChange, createSession, launch, loadInstallers, loadPlatformHint };
}

beforeEach(async () => {
  await setLocale("vi");
});

describe("LegacyFormatDialog", () => {
  it.each(["vi", "en"] as const)("renders the modal copy, filename, and initial focus on the primary button with no download button in %s", async (locale) => {
    await setLocale(locale);
    const longName = "Báo cáo tổng hợp tình hình thực hiện kế hoạch kinh doanh năm 2024.doc";
    renderDialog({ filename: longName });

    const dialog = screen.getByRole("dialog", { name: t("office.legacy.title") });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(t("office.legacy.description"))).toBeInTheDocument();
    const fileLine = within(dialog).getByText(t("office.legacy.file_label", { name: longName }));
    expect(fileLine).toHaveAttribute("title", longName);
    const primaryButton = within(dialog).getByRole("button", { name: t("office.desktop.action") });
    expect(primaryButton).toBeInTheDocument();
    await waitFor(() => expect(primaryButton).toHaveFocus());

    // USER decision: no download button or download split menu on the modal itself.
    expect(within(dialog).queryByRole("button", { name: /tải|download/i })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: t("office.desktop.menu") })).toBeNull();
  });

  it("calls the desktop launch session and deep link on the primary action, shows the launched status, and does not auto-close or open the install prompt when installed", async () => {
    const { onOpenChange, createSession, launch, loadInstallers } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: t("office.desktop.action") }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      operation: "edit",
      deployment_id: "dep-1",
      return_hint: "office",
    })));
    await waitFor(() => expect(launch).toHaveBeenCalledWith(`uniwork-office://open?ticket=${ticket}`, expect.anything()));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(t("office.legacy.launched"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(loadInstallers).not.toHaveBeenCalled();
    expect(screen.queryByText(t("office.desktop.install.title"))).toBeNull();
  });

  it.each(["vi", "en"] as const)("shows the dialog-specific error message with role=alert when preparing the launch session fails in %s", async (locale) => {
    await setLocale(locale);
    renderDialog({
      desktopOpen: {
        deploymentId: "dep-1",
        channel: "stable",
        savedVersion: 2,
        createSession: vi.fn(async () => null),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: t("office.desktop.action") }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("office.legacy.ticket_failed"));
    expect(alert).not.toHaveTextContent(t("office.desktop.ticket_failed"));
  });
  it("opens the install prompt only when the desktop app is not installed / does not answer", async () => {
    const launch = vi.fn(async () => "not-installed" as const);
    const { createSession, loadInstallers } = renderDialog({
      desktopOpen: {
        deploymentId: "dep-1",
        channel: "stable",
        savedVersion: 2,
        createSession: vi.fn(async () => session),
        launch,
        loadInstallers: vi.fn(async () => ({
          installers: [
            {
              platform: "win32-x64" as const,
              channel: "stable" as const,
              url: "https://downloads.test/UniWork-Office.exe",
              kind: ".exe",
            },
          ],
        })),
        loadPlatformHint: vi.fn(async () => ({ platform: "win32-x64" as const, confidence: "certain" as const })),
      },
    });

    expect(screen.queryByText(t("office.desktop.install.title"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("office.desktop.action") }));

    expect(await screen.findByText(t("office.desktop.install.title"))).toBeInTheDocument();
    expect(launch).toHaveBeenCalledOnce();
    void createSession;
    void loadInstallers;
  });

  it("passes version and forces operation=view when opening a historical version", async () => {
    const createSession = vi.fn(async () => session);
    renderDialog({
      version: 1,
      operation: "edit",
      desktopOpen: {
        deploymentId: "dep-1",
        channel: "stable",
        savedVersion: 2,
        createSession,
        launch: vi.fn(async () => "launched" as const),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: t("office.desktop.action") }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      operation: "view",
      version: 1,
      deployment_id: "dep-1",
    })));
  });

  it("closes when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    const closeButton = screen.getByRole("button", { name: t("office.legacy.close") });
    fireEvent.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
