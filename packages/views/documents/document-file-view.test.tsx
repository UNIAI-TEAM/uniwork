import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentFileView } from "./document-file-view";

const featureFlagMock = vi.hoisted(() => ({
  useFlag: vi.fn((_key: string, fallback: boolean) => fallback),
}));
vi.mock("@uniwork/core/feature-flags", () => featureFlagMock);

const { t } = initI18n();

const WS = "ws1";

/** The wire schema parses server enums leniently; the exported type narrows them. */
function narrowDocument(parsed: ReturnType<typeof DocumentSchema.parse>): Document {
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
  };
}

function fileDocument(over: Record<string, unknown> = {}): Document {
  return narrowDocument(DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    kind: "file",
    title: "Báo cáo",
    revision: "3",
    current_version: 2,
    my_level: "edit",
    file: {
      file_id: "f1",
      version_id: "v2",
      version: 2,
      filename: "báo-cáo.pdf",
      mime_type: "application/pdf",
      size_bytes: 482_133,
      checksum_sha256: "a".repeat(64),
    },
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  }));
}

const versions = [
  {
    id: "v2",
    document_id: "d1",
    version: 2,
    kind: "file",
    reason: "upload",
    size_bytes: 482_133,
    checksum_sha256: "a".repeat(64),
    created_at: "2026-09-28T03:00:00Z",
  },
  {
    id: "v1",
    document_id: "d1",
    version: 1,
    kind: "file",
    reason: "upload",
    size_bytes: 1024,
    checksum_sha256: "b".repeat(64),
    created_at: "2026-09-27T03:00:00Z",
  },
];

function mockApi(overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
      return Promise.resolve({ versions, next_cursor: null, ...overrides });
    }
    return Promise.resolve({});
  });
}

function renderView(doc = fileDocument(), readonly = false) {
  return render(wrap(<DocumentFileView wsId={WS} doc={doc} readonly={readonly} />));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  requestMock.mockReset();
  featureFlagMock.useFlag.mockReset().mockImplementation((_key, fallback) => fallback);
});

describe("DocumentFileView", () => {
  it("shows what the file is, version by version", async () => {
    mockApi();
    renderView();

    expect(screen.getByText("báo-cáo.pdf")).toBeInTheDocument();
    expect(screen.getByText("application/pdf · 470,8 KB")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText(t("documents.file.history_title"))).toBeInTheDocument();
    expect(await screen.findByText(t("documents.file.version_row", { no: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("documents.file.version_row", { no: 1 }))).toBeInTheDocument();
  });

  it("promises nothing about editing here: no Office button until G3", async () => {
    mockApi();
    renderView();

    expect(screen.getByText(t("documents.file.no_web_editor_title"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Office/i })).toBeNull();
    // Only download and "new version" are offered.
    expect(screen.getByRole("button", { name: t("documents.file.download") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.file.new_version") })).toBeInTheDocument();
  });

  it("hides the write actions on a read-only file", async () => {
    mockApi();
    renderView(fileDocument({ my_level: "view" }), true);

    expect(screen.getByRole("button", { name: t("documents.file.download") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.file.new_version") })).toBeNull();
  });

  it("mounts the injected Office host only when the flag is enabled", async () => {
    mockApi();
    featureFlagMock.useFlag.mockReturnValue(true);
    const officeHost = vi.fn(({ readonly: isReadonly }: { readonly: boolean }) => (
      <div data-testid="office-host" data-readonly={String(isReadonly)}>Office host</div>
    ));
    render(wrap(<DocumentFileView wsId={WS} doc={fileDocument()} readonly officeEditorHost={officeHost} />));

    expect(await screen.findByTestId("office-host")).toHaveAttribute("data-readonly", "true");
    expect(officeHost).toHaveBeenCalled();
    expect(officeHost.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ wsId: WS, readonly: true }));
    expect(screen.queryByText(t("documents.file.history_title"))).toBeNull();
  });

  it("stages a new version and commits it on the base it started from", async () => {
    const calls: { path: string; opts?: { method?: string; body?: unknown; headers?: Record<string, string> } }[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      calls.push({ path, opts });
      if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
        return Promise.resolve({ versions, next_cursor: null });
      }
      if (path === "/api/v1/documents/d1/uploads") {
        return Promise.resolve({
          upload_id: "f2",
          checksum_sha256: "c".repeat(64),
          size_bytes: 2048,
          claim_expires_at: "2026-09-28T04:00:00Z",
        });
      }
      if (path === "/api/v1/documents/d1/versions/commit") {
        return Promise.resolve({
          document: fileDocument({ revision: "4" }),
          version: { ...versions[0], id: "v3", version: 3 },
        });
      }
      return Promise.resolve({});
    });

    renderView();
    fireEvent.click(screen.getByRole("button", { name: t("documents.file.new_version") }));

    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, {
      target: { files: [new File(["new"], "báo-cáo.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/v1/documents/d1/versions/commit")).toBe(true),
    );
    const commit = calls.find((c) => c.path === "/api/v1/documents/d1/versions/commit");
    expect(commit?.opts?.body).toEqual({ upload_id: "f2", base_revision: "3" });
    expect(commit?.opts?.headers?.["Idempotency-Key"]).toBeTruthy();
    const upload = calls.find((c) => c.path === "/api/v1/documents/d1/uploads");
    expect(upload?.opts?.method).toBe("POST");
    // Same key for the pair: the commit reconciles the upload it staged.
    expect(upload?.opts?.headers?.["Idempotency-Key"]).toBe(commit?.opts?.headers?.["Idempotency-Key"]);
    await waitFor(() => expect(screen.queryByLabelText(t("documents.upload.pick"))).toBeNull());
  });

  it("keeps a failed commit in the dialog instead of claiming a version", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/documents/d1/versions") && !opts?.method) {
        return Promise.resolve({ versions, next_cursor: null });
      }
      if (path === "/api/v1/documents/d1/uploads") {
        return Promise.resolve({
          upload_id: "f2",
          checksum_sha256: "c".repeat(64),
          size_bytes: 2048,
          claim_expires_at: "2026-09-28T04:00:00Z",
        });
      }
      if (path.endsWith("/versions/commit")) return Promise.reject(new Error("stale"));
      return Promise.resolve({});
    });

    renderView();
    fireEvent.click(screen.getByRole("button", { name: t("documents.file.new_version") }));
    fireEvent.change(await screen.findByLabelText(t("documents.upload.pick")), {
      target: { files: [new File(["new"], "báo-cáo.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
  });

  it("downloads the bytes through the authenticated proxy route", async () => {
    mockApi();
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(new Blob(["bytes"], { type: "application/pdf" }), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:document"),
      revokeObjectURL: vi.fn(),
    });
    // jsdom cannot navigate; the click on the synthetic anchor would log an
    // unimplemented-navigation error.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderView();
    fireEvent.click(screen.getByRole("button", { name: t("documents.file.download") }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/documents/d1/download");
  });
});
