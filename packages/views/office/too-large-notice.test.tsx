import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { HeaderActionsMenuItems, HeaderActionsSlotProvider } from "../layout/header-actions-slot";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { DesktopOpenAction } from "./desktop-open-action";
import { OfficeFileActions, OfficeTooLargeNotice, OfficeTooLargeProvider } from "./too-large-notice";

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

  it("says to download, not to open the app, when the host offers no desktop launch", () => {
    render(
      <OfficeTooLargeProvider value={{ onDownload: async () => undefined, desktopAction: null }}>
        <OfficeTooLargeNotice format="docx" />
      </OfficeTooLargeProvider>,
    );
    expect(screen.getByText(copy.description_download_only.replace("{{format}}", "DOCX"))).toBeInTheDocument();
    expect(screen.queryByText(/UniWork Office/)).toBeNull();
    expect(screen.queryByRole("button", { name: launchLabel })).toBeNull();
    expect(screen.getByRole("button", { name: copy.download })).toBeInTheDocument();
  });

  it.each([
    [
      "too_large_to_open",
      "Tệp DOCX này quá lớn để trình duyệt mở. Mở tệp bằng app UniWork Office trên máy tính để tiếp tục làm việc.",
      "Tệp DOCX này quá lớn để trình duyệt mở. Hãy tải tệp xuống để tiếp tục làm việc.",
    ],
    [
      "engine_out_of_memory",
      "Trình duyệt không đủ bộ nhớ để mở tệp DOCX này. Mở tệp bằng app UniWork Office trên máy tính để tiếp tục làm việc.",
      "Trình duyệt không đủ bộ nhớ để mở tệp DOCX này. Hãy tải tệp xuống để tiếp tục làm việc.",
    ],
    [
      "too_complex",
      "Tệp DOCX này có quá nhiều nội dung để trình duyệt xử lý. Mở tệp bằng app UniWork Office trên máy tính để tiếp tục làm việc.",
      "Tệp DOCX này có quá nhiều nội dung để trình duyệt xử lý. Hãy tải tệp xuống để tiếp tục làm việc.",
    ],
  ] as const)("renders the exact vi refusal copy and download-only variant for reason=%s", (reason, withApp, downloadOnly) => {
    const first = withHost(<OfficeTooLargeNotice format="docx" reason={reason} />, async () => undefined);
    expect(screen.getByText("Không mở được tệp này trên web")).toBeInTheDocument();
    expect(screen.getByText(withApp)).toBeInTheDocument();
    first.unmount();

    render(
      <OfficeTooLargeProvider value={{ onDownload: async () => undefined, desktopAction: null }}>
        <OfficeTooLargeNotice format="docx" reason={reason} />
      </OfficeTooLargeProvider>,
    );
    expect(screen.getByText("Không mở được tệp này trên web")).toBeInTheDocument();
    expect(screen.getByText(downloadOnly)).toBeInTheDocument();
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

  it("puts a leading action (a frame failure's Retry) before the desktop launch and Download", () => {
    withHost(<OfficeFileActions leading={<button type="button">Thử lại</button>} />, async () => undefined);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons[0]).toBe("Thử lại");
    expect(screen.getByRole("button", { name: launchLabel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.download })).toBeInTheDocument();
  });

  it("renders nothing without a provider or a leading action", () => {
    const { container } = render(<OfficeFileActions />);
    expect(container).toBeEmptyDOMElement();
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
