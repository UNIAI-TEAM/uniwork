import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { HeaderActionsMenuItems, HeaderActionsSlotProvider } from "../layout/header-actions-slot";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { DesktopOpenAction } from "./desktop-open-action";
import { DocxErrorState } from "./docx/docx-error-state";
import { PdfErrorState } from "./pdf/pdf-error-state";
import { XlsxErrorState } from "./xlsx/xlsx-error-state";
import { OfficeTooLargeNotice, OfficeTooLargeProvider } from "./too-large-notice";

// The views suite runs in vi (test/setup.ts).
const copy = viLocale.office.too_large;
const launchLabel = viLocale.office.desktop.action;

function withHost(node: React.ReactNode, onDownload?: () => Promise<void>) {
  return render(
    <OfficeTooLargeProvider value={{ onDownload, desktopAction: <DesktopOpenAction documentId="doc" deploymentId="dep" savedVersion={1} placement="inline" /> }}>
      {node}
    </OfficeTooLargeProvider>,
  );
}

describe("OfficeTooLargeNotice", () => {
  it("names the format, offers the desktop launch first and Download second", () => {
    withHost(<OfficeTooLargeNotice format="docx" />, async () => undefined);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(/DOCX/)).toBeInTheDocument();
    const launch = screen.getByRole("button", { name: launchLabel });
    const download = screen.getByRole("button", { name: copy.download });
    expect(launch.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders only the message without a provider (no buttons to offer)", () => {
    render(<OfficeTooLargeNotice format="xlsx" />);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("downloads the document file and reports a failed download", async () => {
    const onDownload = vi.fn().mockRejectedValueOnce(new Error("boom"));
    withHost(<OfficeTooLargeNotice format="pdf" />, onDownload);
    fireEvent.click(screen.getByRole("button", { name: copy.download }));
    expect(await screen.findByText(copy.download_failed)).toBeInTheDocument();
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it.each([
    ["docx", <DocxErrorState key="d" failure={{ outcome: "failed", document_id: "d", format: "docx", failure_class: "too_large" }} />],
    ["pdf", <PdfErrorState key="p" failure={{ outcome: "failed", document_id: "d", format: "pdf", failure_class: "too_large" }} />],
    ["xlsx", <XlsxErrorState key="x" failure={{ outcome: "failed", document_id: "d", format: "xlsx", failure_class: "too_large" }} />],
  ])("%s open failure too_large renders the shared notice with both actions", (_format, node) => {
    withHost(node, async () => undefined);
    expect(screen.getByTestId("office-too-large")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: launchLabel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.download })).toBeInTheDocument();
  });

  it("keeps a non-size failure on the generic error screen", () => {
    withHost(<XlsxErrorState failure={{ outcome: "failed", document_id: "d", format: "xlsx", failure_class: "engine_error" }} />);
    expect(screen.queryByTestId("office-too-large")).not.toBeInTheDocument();
  });

  it("an inline desktop action stays visible and does not fill the page-header menu", async () => {
    render(
      <HeaderActionsSlotProvider>
        <DesktopOpenAction documentId="doc" deploymentId="dep" savedVersion={1} placement="inline" />
        <DropdownMenu open><DropdownMenuContent><HeaderActionsMenuItems /></DropdownMenuContent></DropdownMenu>
      </HeaderActionsSlotProvider>,
    );
    const group = screen.getByRole("button", { name: launchLabel }).closest("[data-slot=button-group]")!;
    expect(group).not.toHaveClass("hidden");
    await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
  });
});
