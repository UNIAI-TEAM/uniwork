import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { HeaderActionsFill } from "../layout/header-actions-slot";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: vi.fn((key: string, fallback: boolean) => (key === "office_engine" ? true : fallback)),
}));

initI18n();

function docxDocument(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo.docx",
    revision: "3",
    current_version: 2,
    my_level: "edit",
    file: {
      file_id: "f1",
      version_id: "v2",
      version: 2,
      filename: "báo-cáo.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: 1024,
      checksum_sha256: "a".repeat(64),
    },
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
  };
}

/** Stands in for the web Office host: an embedded shell fills the slot. */
function FakeOfficeHost() {
  return (
    <div data-testid="office-host">
      <HeaderActionsFill actions={<button type="button">office-save</button>} />
    </div>
  );
}

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue({});
});

describe("DocumentWorkspace header slot", () => {
  it("shows the embedded editor cluster in the one page header, before the page menu", async () => {
    const { container } = render(wrapWithNav(
      <DocumentWorkspace
        wsId="ws1"
        doc={docxDocument()}
        libraryHref="/acme/doi/documents"
        refetch={vi.fn(() => Promise.resolve({}))}
        officeEditorHost={FakeOfficeHost}
        headerActions={<button type="button">page-menu</button>}
      />,
    ));
    expect(await screen.findByTestId("office-host")).toBeInTheDocument();
    const headers = container.querySelectorAll("header");
    expect(headers).toHaveLength(1);
    await waitFor(() => expect(headers[0]!.querySelector("[data-header-actions-slot]")).not.toBeNull());
    const labels = [...headers[0]!.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels.indexOf("office-save")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("office-save")).toBeLessThan(labels.indexOf("page-menu"));
    expect(labels.at(-1)).toBe("page-menu");
  });

  it("keeps the editor out of the workspace when the organization turns the format off", async () => {
    requestMock.mockImplementation((path: string) => Promise.resolve(path === "/api/v1/config?organization_id=org1" ? { flags: { office_engine: true, office_docx: false } } : {}));
    render(wrapWithNav(
      <DocumentWorkspace
        wsId="ws1"
        doc={docxDocument({ organization_id: "org1" })}
        libraryHref="/acme/doi/documents"
        refetch={vi.fn(() => Promise.resolve({}))}
        officeEditorHost={FakeOfficeHost}
      />,
    ));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/config?organization_id=org1", expect.anything()));
    expect(screen.queryByTestId("office-host")).toBeNull();
  });
});
