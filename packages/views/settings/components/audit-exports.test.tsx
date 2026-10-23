import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { AuditExport } from "@uniwork/core/types";
import { downloadAuditExport } from "@uniwork/core/api/endpoints/audit";
import { requestMock, wrap } from "../../test/api-mock";
import { AuditExports } from "./audit-exports";

initI18n();

vi.mock("sonner", async (orig) => {
  const mod = await orig<typeof import("sonner")>();
  return { ...mod, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

vi.mock("@uniwork/core/api/endpoints/audit", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/audit")>()),
  downloadAuditExport: vi.fn(),
}));
const downloadMock = vi.mocked(downloadAuditExport);

const baseJob: AuditExport = {
  id: "e1",
  format: "csv",
  from_at: "2026-09-01T00:00:00Z",
  to_at: "2026-09-08T00:00:00Z",
  status: "done",
  row_count: 3,
  created_at: "2026-09-10T00:00:00Z",
  expires_at: "2026-09-11T00:00:00Z",
};

function renderWithJob(job: AuditExport) {
  requestMock.mockImplementation((path: string) => {
    if (path.includes("/audit/exports")) return Promise.resolve({ exports: [job] });
    return Promise.resolve({});
  });
  return render(wrap(<AuditExports orgId="o1" canManage />));
}

async function downloadButton() {
  return await screen.findByRole("button", { name: "Tải về" });
}

describe("AuditExports download", () => {
  let anchors: HTMLAnchorElement[];
  beforeEach(() => {
    vi.restoreAllMocks();
    requestMock.mockReset();
    downloadMock.mockReset();
    anchors = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("opens a legacy storage URL directly instead of fetching through the API", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithJob({ ...baseJob, download_url: "https://storage.example.com/audit-1.csv" });
    fireEvent.click(await downloadButton());
    expect(openSpy).toHaveBeenCalledWith(
      "https://storage.example.com/audit-1.csv",
      "_blank",
      "noopener,noreferrer",
    );
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("saves the blob under the server's filename for an API download path", async () => {
    downloadMock.mockResolvedValue(new Blob(["data"], { type: "text/csv" }));

    renderWithJob({ ...baseJob, download_url: "/api/v1/orgs/o1/audit/exports/e1/download" });
    fireEvent.click(await downloadButton());

    await waitFor(() => expect(anchors.at(-1)?.download).toBe("audit-20260901-20260908.csv"));
    expect(downloadMock).toHaveBeenCalledWith("o1", "e1");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x"));
  });

  it("reports a failed download through the error toast and re-enables the button", async () => {
    downloadMock.mockRejectedValue(new Error("gone"));
    renderWithJob({ ...baseJob, download_url: "/api/v1/orgs/o1/audit/exports/e1/download" });
    const button = await downloadButton();
    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("disables the button while the download is in flight", async () => {
    let release!: (blob: Blob) => void;
    downloadMock.mockImplementation(
      () => new Promise<Blob>((resolve) => (release = resolve)),
    );
    renderWithJob({ ...baseJob, download_url: "/api/v1/orgs/o1/audit/exports/e1/download" });
    const button = await downloadButton();
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(downloadMock).toHaveBeenCalledTimes(1);
    release(new Blob(["data"]));
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
