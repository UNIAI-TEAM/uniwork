import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  clearResumableUpload,
  findResumableUpload,
  saveResumableUpload,
  uploadFileKey,
} from "@uniwork/core/documents/chunked-upload";
import { forgetHeldEditLock, registerHeldEditLock } from "@uniwork/core/documents/edit-lock-registry";
import { documentKeys } from "@uniwork/core/documents/keys";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { defaultStorage } from "@uniwork/core/platform";
import type { User, Workspace } from "@uniwork/core/types";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { editLockRoute } from "../test/edit-lock-fake";
import { DocumentFileView } from "./document-file-view";
import { DocumentsPageView } from "./documents-page-view";
import { onWriteRefused } from "./edit-lock-refusal";

const { t } = initI18n();
const WS = "ws1";
const THRESHOLD = 8 * 1024 * 1024;

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function makePdfFile(sizeBytes: number, name = "large-report.pdf"): File {
  const header = new TextEncoder().encode("%PDF-1.7\n");
  const file = new File([header], name, { type: "application/pdf", lastModified: 1760700000000 });
  Object.defineProperty(file, "size", { value: sizeBytes });
  const origSlice = file.slice.bind(file);
  vi.spyOn(file, "slice").mockImplementation((start = 0, end = sizeBytes) => {
    const len = Math.max(0, Math.min(sizeBytes, end) - Math.max(0, start));
    if (start === 0) return origSlice(0, Math.min(header.byteLength, len));
    const blob = new Blob(["x"]);
    Object.defineProperty(blob, "size", { value: len });
    return blob;
  });
  return file;
}

function createdFileDoc(id = "d-large"): Document {
  const parsed = DocumentSchema.parse({
    id,
    workspace_id: WS,
    organization_id: "org1",
    kind: "file",
    title: "large-report.pdf",
    revision: "1",
    current_version: 1,
    my_level: "edit",
    file: {
      file_id: `file-${id}`,
      version_id: "v1",
      version: 1,
      filename: "large-report.pdf",
      mime_type: "application/pdf",
      size_bytes: THRESHOLD + 1024,
      checksum_sha256: "a".repeat(64),
    },
    created_at: "2026-10-17T12:00:00Z",
    updated_at: "2026-10-17T12:00:00Z",
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
    system_kind: parsed.system_kind as Document["system_kind"],
  };
}
function myFolderDoc(): Document {
  const parsed = DocumentSchema.parse({
    id: "mf1",
    workspace_id: WS,
    organization_id: "org1",
    kind: "folder",
    title: "My Folder",
    system_kind: "my_folder",
    visibility: "restricted",
    revision: "1",
    my_level: "manage",
    created_at: "2026-10-17T12:00:00Z",
    updated_at: "2026-10-17T12:00:00Z",
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
    system_kind: parsed.system_kind as Document["system_kind"],
  };
}

// The tree row that makes `myFolderId` known without a my-folder POST.
const MY_FOLDER_TREE_NODE = {
  id: "mf1",
  title: "My Folder",
  kind: "folder",
  system_kind: "my_folder",
  position: 0,
  children: [],
};


const makePartUrls = (nums: number[]) =>
  nums.map((n) => ({
    part_number: n,
    method: "PUT",
    url: `https://s3.test/upload/part-${n}`,
    headers: { "x-part": String(n) },
    expires_at: "2099-01-01T00:00:00Z",
  }));

function renderPageView(onOpen = vi.fn()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={sessionUser}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={onOpen} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      fakeNav(),
    ),
  );
}

/**
 * Resolves once the `/api/v1/config` limits request has been made, its result has
 * settled, and TanStack Query has delivered it to the mounted view. Dropping before
 * that leaves `chunked_upload_threshold_bytes` unknown, so a large file takes the
 * single-request path and never shows the chunked drop toast.
 */
async function waitForUploadLimits(): Promise<void> {
  const configIndex = () =>
    requestMock.mock.calls.findIndex((c) => String(c[0]).startsWith("/api/v1/config"));
  await waitFor(() => expect(configIndex()).toBeGreaterThanOrEqual(0));
  const settled = requestMock.mock.results[configIndex()]?.value as Promise<unknown>;
  await act(async () => {
    await settled;
    // TanStack Query notifies observers from a zero-delay timer after the fetch settles.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  requestMock.mockReset();
  vi.stubGlobal("XMLHttpRequest", undefined);
  resetAuthStoreForTests();
  setSessionUser({
    id: "u1",
    email: "an@example.com",
    display_name: "An",
    onboarded_at: "2026-08-25T00:00:00Z",
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Chunked document upload in views", () => {
  it("routes a file above chunkedUploadThreshold through upload-sessions with progress UI and never calls /documents/files", async () => {
    const calls: string[] = [];
    let resolveComplete!: () => void;
    const completeGate = new Promise<void>((r) => {
      resolveComplete = r;
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-ws-1",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-ws-1/complete" && method === "POST") {
        await completeGate;
        return { document: createdFileDoc("d-large") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const partNum = Number(/part-(\d+)/.exec(url)?.[1] ?? "1");
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }),
    );

    const onOpen = vi.fn();
    renderPageView(onOpen);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const bigFile = makePdfFile(THRESHOLD + 1024, "large-report.pdf");
    fireEvent.change(input, { target: { files: [bigFile] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByText(t("documents.upload.checking"))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveClass("*:data-[slot=progress-track]:bg-border");
    expect(screen.getByText("100%")).toBeInTheDocument();

    await act(async () => {
      resolveComplete();
    });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d-large"));
    expect(calls).toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
    expect(calls).toContain("POST /api/v1/upload-sessions/sess-ws-1/complete");
    expect(calls).not.toContain(`POST /api/v1/workspaces/${WS}/documents/files`);
  });

  it("opens a Home-root chunked session under My Folder, ensuring it first when no parent is open", async () => {
    const calls: string[] = [];
    const sessionBodies: unknown[] = [];
    let ensureCalls = 0;
    const myFolderUrl = `/api/v1/workspaces/${WS}/documents/my-folder`;
    const sessionUrl = `/api/v1/workspaces/${WS}/documents/upload-sessions`;

    requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      // No My Folder in the tree: the session opener must ensure it first.
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
      if (path === myFolderUrl && method === "POST") {
        ensureCalls += 1;
        return { document: myFolderDoc() };
      }
      if (path === sessionUrl && method === "POST") {
        sessionBodies.push(opts?.body);
        return {
          session_id: "sess-mf-drop",
          part_size: THRESHOLD,
          total_parts: 1,
          completed_parts: [],
          parts: makePartUrls([1]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-mf-drop/complete" && method === "POST") {
        return { document: createdFileDoc("d-mf-drop") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })),
    );

    renderPageView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await waitForUploadLimits();
    const dropRegion = screen.getByRole("region", { name: t("documents.page.title") });
    fireEvent.drop(dropRegion, {
      dataTransfer: { types: ["Files"], files: [makePdfFile(THRESHOLD + 1024, "drop-mf.pdf")] },
    });

    await waitFor(() =>
      expect(calls).toContain("POST /api/v1/upload-sessions/sess-mf-drop/complete"),
    );
    expect(ensureCalls).toBe(1);
    expect(sessionBodies).toHaveLength(1);
    expect(sessionBodies[0]).toMatchObject({ parent_id: "mf1" });
    // The session open must follow the ensure, never run at the workspace root.
    expect(calls.indexOf(`POST ${myFolderUrl}`)).toBeLessThan(calls.indexOf(`POST ${sessionUrl}`));
    expect(calls).not.toContain(`POST /api/v1/workspaces/${WS}/documents/files`);
  });

  it("ignores an old root resume record for a Home-root chunked upload and opens a fresh session under My Folder", async () => {
    const calls: string[] = [];
    const sessionBodies: unknown[] = [];
    const sessionUrl = `/api/v1/workspaces/${WS}/documents/upload-sessions`;
    const dropFile = makePdfFile(THRESHOLD + 1024, "drop-stale.pdf");
    saveResumableUpload(defaultStorage, uploadFileKey(dropFile), { kind: "workspace", workspaceId: WS }, {
      session_id: "sess-stale-root",
      expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: "idem-stale-root",
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === sessionUrl && method === "POST") {
        sessionBodies.push(opts?.body);
        return {
          session_id: "sess-fresh-mf",
          part_size: THRESHOLD,
          total_parts: 1,
          completed_parts: [],
          parts: makePartUrls([1]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-fresh-mf/complete" && method === "POST") {
        return { document: createdFileDoc("d-fresh-mf") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })),
    );

    renderPageView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await waitForUploadLimits();
    fireEvent.drop(screen.getByRole("region", { name: t("documents.page.title") }), {
      dataTransfer: { types: ["Files"], files: [dropFile] },
    });

    await waitFor(() =>
      expect(calls).toContain("POST /api/v1/upload-sessions/sess-fresh-mf/complete"),
    );
    expect(sessionBodies).toHaveLength(1);
    expect(sessionBodies[0]).toMatchObject({ parent_id: "mf1" });
    expect(calls.some((c) => c.includes("sess-stale-root"))).toBe(false);
  });

  it("keeps a file at or below threshold on the single-request /documents/files path", async () => {
    const calls: string[] = [];
    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/files` && method === "POST") {
        return { document: createdFileDoc("d-small") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    const onOpen = vi.fn();
    renderPageView(onOpen);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const smallFile = makePdfFile(1024, "small.pdf");
    fireEvent.change(input, { target: { files: [smallFile] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d-small"));
    expect(calls).toContain(`POST /api/v1/workspaces/${WS}/documents/files`);
    expect(calls).not.toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
  });

  it("supports Pause (Tạm dừng), Resume (Tiếp tục), and Cancel (Hủy) buttons during chunked upload", async () => {
    const calls: string[] = [];

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-pause",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-pause" && method === "GET") {
        return {
          session_id: "sess-pause",
          status: "open",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [{ part_number: 1, etag: '"etag-1"', size: THRESHOLD }],
          parts: makePartUrls([2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-pause" && method === "DELETE") {
        return {};
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("part-1")) {
          return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    renderPageView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const bigFile = makePdfFile(THRESHOLD * 2, "pause-test.pdf");
    fireEvent.change(input, { target: { files: [bigFile] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    const pauseBtn = await screen.findByRole("button", { name: t("documents.upload.pause") });
    expect(pauseBtn).toHaveClass("border-input");
    const statusLine = screen.getByTestId("document-upload-status");
    expect(statusLine).toHaveClass("min-h-4");
    expect(statusLine).toBeEmptyDOMElement();
    fireEvent.click(pauseBtn);

    const resumeBtn = await screen.findByRole("button", { name: t("documents.upload.resume") });
    expect(resumeBtn).toBeInTheDocument();
    expect(screen.getByTestId("document-upload-status")).toHaveTextContent(
      t("documents.upload.paused_status"),
    );

    fireEvent.click(resumeBtn);
    await screen.findByRole("button", { name: t("documents.upload.pause") });
    expect(calls).toContain("GET /api/v1/upload-sessions/sess-pause");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.cancel") }));

    await waitFor(() => {
      expect(calls).toContain("DELETE /api/v1/upload-sessions/sess-pause");
    });
  });

  it("resumes a Home-root pick from completed parts when the open resume record sits under My Folder", async () => {
    const bigFile = makePdfFile(THRESHOLD * 2, "resumable.pdf");
    const target = { kind: "workspace" as const, workspaceId: WS, parentId: "mf1" };
    saveResumableUpload(defaultStorage, uploadFileKey(bigFile), target, {
      session_id: "sess-resume-1",
      expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: "idem-resume-1",
    });

    const calls: string[] = [];
    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === "/api/v1/upload-sessions/sess-resume-1" && method === "GET") {
        return {
          session_id: "sess-resume-1",
          status: "uploading",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [{ part_number: 1, etag: '"etag-1"', size: THRESHOLD }],
          parts: makePartUrls([2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-resume-1/complete" && method === "POST") {
        return { document: createdFileDoc("d-resumed") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    const putUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        putUrls.push(url);
        return new Response(null, { status: 200, headers: { ETag: '"etag-2"' } });
      }),
    );

    const onOpen = vi.fn();
    renderPageView(onOpen);
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(await screen.findByText(t("documents.upload.resume_hint"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d-resumed"));
    expect(calls).toContain("GET /api/v1/upload-sessions/sess-resume-1");
    expect(calls).not.toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
    expect(putUrls).toEqual(["https://s3.test/upload/part-2"]);
  });

  it("stages a large new version via upload-sessions and commits with upload_id and held edit_lock_id", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const doc = createdFileDoc("d1");

    requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? "GET";
      calls.push({ path, method, body: opts?.body });
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 150 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 150 * 1024 * 1024,
              xlsx_max_bytes: 150 * 1024 * 1024,
              pptx_max_bytes: 150 * 1024 * 1024,
              pdf_max_bytes: 150 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith("/api/v1/documents/d1/versions") && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === "/api/v1/documents/d1/upload-sessions" && method === "POST") {
        return {
          session_id: "sess-ver-1",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-ver-1/complete" && method === "POST") {
        return {
          upload_id: "up-chunked-1",
          checksum_sha256: "b".repeat(64),
          size_bytes: THRESHOLD + 1024,
          claim_expires_at: "2099-01-02T01:00:00Z",
        };
      }
      if (path === "/api/v1/documents/d1/versions/commit" && method === "POST") {
        return {
          document: createdFileDoc("d1"),
          version: {
            id: "v2",
            document_id: "d1",
            version: 2,
            kind: "file",
            reason: "upload",
            size_bytes: THRESHOLD + 1024,
            checksum_sha256: "b".repeat(64),
            created_at: "2026-10-17T12:05:00Z",
          },
        };
      }
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const partNum = Number(/part-(\d+)/.exec(url)?.[1] ?? "1");
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }),
    );

    registerHeldEditLock("d1", "lock-42");
    try {
      render(wrap(<DocumentFileView wsId={WS} doc={doc} readonly={false} />));
      fireEvent.click(screen.getByRole("button", { name: t("documents.file.new_version") }));
      await screen.findByText(t("documents.upload.size_hint", { max: "150 MB" }));
      const input = await screen.findByLabelText(t("documents.upload.pick"));
      const bigFile = makePdfFile(THRESHOLD + 1024, "v2-large.pdf");
      fireEvent.change(input, { target: { files: [bigFile] } });
      fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

      await waitFor(() => {
        expect(calls.some((c) => c.path === "/api/v1/documents/d1/versions/commit")).toBe(true);
      });
      const commitCall = calls.find((c) => c.path === "/api/v1/documents/d1/versions/commit");
      expect(commitCall?.body).toEqual({
        upload_id: "up-chunked-1",
        base_revision: "1",
        edit_lock_id: "lock-42",
      });
      expect(calls.some((c) => c.path === "/api/v1/documents/d1/uploads")).toBe(false);
    } finally {
      forgetHeldEditLock("lock-42");
    }
  });

  it("renders localized error copy in the dialog for upload session error codes", async () => {
    let nextCode = "upload_sessions_exhausted";
    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        throw new ApiError("raw server error", nextCode, 422);
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    renderPageView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const bigFile = makePdfFile(THRESHOLD + 1024, "err-test.pdf");
    fireEvent.change(input, { target: { files: [bigFile] } });

    for (const code of [
      "upload_sessions_exhausted",
      "upload_session_expired",
      "upload_parts_invalid",
      "upload_size_mismatch",
      "upload_probe_mismatch",
      "quota_exceeded",
    ]) {
      nextCode = code;
      fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t(`documents.errors.${code}`));
    }
  });

  it("cancels the paused upload when the dialog is closed while paused so reopening starts with clean state", async () => {
    const calls: string[] = [];

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-pause-close",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-pause-close" && method === "DELETE") {
        return {};
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("part-1")) {
          return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    renderPageView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const bigFile = makePdfFile(THRESHOLD * 2, "pause-close.pdf");
    fireEvent.change(input, { target: { files: [bigFile] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    const pauseBtn = await screen.findByRole("button", { name: t("documents.upload.pause") });
    fireEvent.click(pauseBtn);
    await screen.findByRole("button", { name: t("documents.upload.resume") });

    // Close the dialog via the dialog header X button while paused.
    fireEvent.click(screen.getByRole("button", { name: t("common.close") }));

    await waitFor(() => {
      expect(calls).toContain("DELETE /api/v1/upload-sessions/sess-pause-close");
    });

    // Reopen the dialog: it must not show a stuck paused state with no file.
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    await screen.findByLabelText(t("documents.upload.pick"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.upload.resume") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.upload.submit") })).toBeDisabled();
  });

  it("does not call onOpen when the view unmounts while a chunked upload is completing", async () => {
    let resolveComplete!: () => void;
    const completeGate = new Promise<void>((r) => {
      resolveComplete = r;
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-unmount-view",
          part_size: THRESHOLD,
          total_parts: 1,
          completed_parts: [],
          parts: makePartUrls([1]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-unmount-view/complete" && method === "POST") {
        await completeGate;
        return { document: createdFileDoc("d-unmount") };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })),
    );

    const onOpen = vi.fn();
    const { unmount } = renderPageView(onOpen);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const bigFile = makePdfFile(THRESHOLD + 1024, "unmount-view.pdf");
    fireEvent.change(input, { target: { files: [bigFile] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await screen.findByText(t("documents.upload.checking"));
    unmount();

    await act(async () => {
      resolveComplete();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("dismisses the drop loading toast when the library unmounts mid-upload, so no Cancel toast is left behind", async () => {
    const loadingSpy = vi.spyOn(toast, "loading").mockReturnValue("drop-toast-unmount");
    const dismissSpy = vi.spyOn(toast, "dismiss").mockReturnValue("");
    vi.spyOn(toast, "error").mockReturnValue("");
    vi.spyOn(toast, "success").mockReturnValue("");

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-drop-unmount",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    // Every part PUT hangs until aborted: the drop's `chunked.start()` never settles.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const { unmount } = renderPageView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await waitForUploadLimits();
    const dropRegion = screen.getByRole("region", { name: t("documents.page.title") });
    const bigFile = makePdfFile(THRESHOLD * 2, "dropped-unmount.pdf");

    fireEvent.drop(dropRegion, { dataTransfer: { types: ["Files"], files: [bigFile] } });
    await waitFor(() => expect(loadingSpy).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(dismissSpy).toHaveBeenCalledWith("drop-toast-unmount"));
  });

  it("shows a loading toast with a Cancel action when dropping a file above threshold and suppresses toast.error on cancel", async () => {
    const calls: string[] = [];
    const loadingSpy = vi.spyOn(toast, "loading").mockReturnValue("drop-toast-1");
    const dismissSpy = vi.spyOn(toast, "dismiss").mockReturnValue("");
    const errorSpy = vi.spyOn(toast, "error").mockReturnValue("");
    const successSpy = vi.spyOn(toast, "success").mockReturnValue("");

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) {
        return {
          flags: { documents: true },
          documents: {
            limits: {
              upload_max_bytes: 200 * 1024 * 1024,
              chunked_upload_threshold_bytes: THRESHOLD,
              docx_max_bytes: 200 * 1024 * 1024,
              xlsx_max_bytes: 200 * 1024 * 1024,
              pptx_max_bytes: 200 * 1024 * 1024,
              pdf_max_bytes: 200 * 1024 * 1024,
            },
          },
        };
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-drop-cancel",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-drop-cancel" && method === "DELETE") {
        return {};
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("part-1")) {
          return new Response(null, { status: 200, headers: { ETag: '"etag-1"' } });
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    renderPageView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await waitForUploadLimits();
    const dropRegion = screen.getByRole("region", { name: t("documents.page.title") });
    const bigFile = makePdfFile(THRESHOLD * 2, "dropped-large.pdf");

    fireEvent.drop(dropRegion, {
      dataTransfer: { types: ["Files"], files: [bigFile] },
    });

    await waitFor(() => {
      expect(loadingSpy).toHaveBeenCalledWith(
        "Đang tải lên dropped-large.pdf · 0%",
        expect.objectContaining({
          action: expect.objectContaining({
            label: t("documents.upload.cancel"),
          }),
        }),
      );
      expect(loadingSpy).toHaveBeenCalledWith(
        "Đang tải lên dropped-large.pdf · 50%",
        expect.objectContaining({
          id: "drop-toast-1",
          action: expect.objectContaining({
            label: t("documents.upload.cancel"),
          }),
        }),
      );
      expect(calls).toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
    });
    expect(loadingSpy).toHaveBeenCalledTimes(2);

    const toastOpts = loadingSpy.mock.calls[0]?.[1] as {
      action?: { label: string; onClick: () => void };
    };
    act(() => {
      toastOpts.action?.onClick();
    });

    await waitFor(() => {
      expect(calls).toContain("DELETE /api/v1/upload-sessions/sess-drop-cancel");
      expect(dismissSpy).toHaveBeenCalledWith("drop-toast-1");
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });
});

describe("BIGUP-LOCKCHECK: edit-lock pre-check and create-time 423 on large new versions (UNI-1890)", () => {
  const DOC_ID = "d1";
  const VERSION_TARGET = { kind: "version" as const, documentId: DOC_ID };

  const LIMITS_CONFIG = {
    flags: { documents: true },
    documents: {
      limits: {
        upload_max_bytes: 150 * 1024 * 1024,
        chunked_upload_threshold_bytes: THRESHOLD,
        docx_max_bytes: 150 * 1024 * 1024,
        xlsx_max_bytes: 150 * 1024 * 1024,
        pptx_max_bytes: 150 * 1024 * 1024,
        pdf_max_bytes: 150 * 1024 * 1024,
      },
    },
  };

  function lockStateResponse(
    lock: {
      holder_id: string;
      holder_name: string;
      held_by_me: boolean;
      since?: string;
      expires_at?: string;
      reserved?: boolean;
    } | null,
  ) {
    return {
      lock: lock
        ? {
            holder_id: lock.holder_id,
            holder_name: lock.holder_name,
            since: lock.since ?? "2026-10-18T01:00:00Z",
            expires_at: lock.expires_at ?? "2026-10-18T01:02:00Z",
            reserved: lock.reserved ?? false,
            held_by_me: lock.held_by_me,
          }
        : null,
      my_request: null,
      pending_requests: [],
      can_take_over: false,
      can_request: false,
      server_time: "2026-10-18T01:00:30Z",
    };
  }

  async function openDialogAndSubmit(file: File, client?: QueryClient) {
    const doc = createdFileDoc(DOC_ID);
    render(wrap(<DocumentFileView wsId={WS} doc={doc} readonly={false} />, client));
    fireEvent.click(screen.getByRole("button", { name: t("documents.file.new_version") }));
    await screen.findByText(t("documents.upload.size_hint", { max: "150 MB" }));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
  }

  it("refuses a large new version before session create when another holder holds the edit lock, leaving any resume record untouched", async () => {
    const calls: string[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "locked-other.pdf");
    saveResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET, {
      session_id: "sess-prior-1",
      expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: "idem-prior-1",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    });
    // Seed a cached unlocked state so staleTime: 0 must fetch fresh from the server.
    client.setQueryData(documentKeys.editLock(WS, DOC_ID), lockStateResponse(null));

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      // A manage-level reader's summary carries lock_id; a server 423 never does.
      const state = lockStateResponse({ holder_id: "u2", holder_name: "Bình", held_by_me: false });
      return { ...state, lock: { ...state.lock, lock_id: "lock-secret-1" } };
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      return {};
    });

    const putSpy = vi.fn();
    vi.stubGlobal("fetch", putSpy);
    const refused = vi.fn();
    const off = onWriteRefused(DOC_ID, refused);

    try {
      await openDialogAndSubmit(bigFile, client);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t("documents.upload.document_locked"));
      expect(calls).toContain(`GET /api/v1/documents/${DOC_ID}/edit-lock`);
      expect(calls).not.toContain(`POST /api/v1/documents/${DOC_ID}/upload-sessions`);
      expect(calls).not.toContain("GET /api/v1/upload-sessions/sess-prior-1");
      expect(putSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(refused).toHaveBeenCalledWith(
        expect.objectContaining({ holder_id: "u2", holder_name: "Bình", held_by_me: false }),
        undefined,
      );
      expect(refused.mock.calls[0]?.[0]).not.toHaveProperty("lock_id");
      expect(findResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET)).toEqual({
        session_id: "sess-prior-1",
        expires_at: "2099-01-01T00:00:00Z",
        idempotency_key: "idem-prior-1",
      });
    } finally {
      off();
      clearResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET);
    }
  });

  it("refuses a large new version when held by me in another tab, mirroring checkDocumentEditLock in server/internal/service/document_edit_lock.go", async () => {
    // checkDocumentEditLock in server/internal/service/document_edit_lock.go passes a commit
    // only when edit_lock_id equals the live lock id, so a same-person commit from a tab
    // without the id is refused at commit; the client pre-check mirrors it.
    const calls: string[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "locked-other-tab.pdf");
    saveResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET, {
      session_id: "sess-prior-2",
      expires_at: "2099-01-01T00:00:00Z",
      idempotency_key: "idem-prior-2",
    });

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      return lockStateResponse({
        holder_id: "u1",
        holder_name: "An",
        held_by_me: true,
      });
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      return {};
    });

    const putSpy = vi.fn();
    vi.stubGlobal("fetch", putSpy);
    const refused = vi.fn();
    const off = onWriteRefused(DOC_ID, refused);

    try {
      await openDialogAndSubmit(bigFile);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t("documents.upload.document_locked"));
      expect(calls).toContain(`GET /api/v1/documents/${DOC_ID}/edit-lock`);
      expect(calls).not.toContain(`POST /api/v1/documents/${DOC_ID}/upload-sessions`);
      expect(calls).not.toContain("GET /api/v1/upload-sessions/sess-prior-2");
      expect(putSpy).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledWith(
        expect.objectContaining({ holder_id: "u1", holder_name: "An", held_by_me: true }),
        undefined,
      );
      expect(findResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET)).toEqual({
        session_id: "sess-prior-2",
        expires_at: "2099-01-01T00:00:00Z",
        idempotency_key: "idem-prior-2",
      });
    } finally {
      off();
      clearResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET);
    }
  });

  it("passes the pre-check and commits with edit_lock_id when the lock is held in this tab", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "held-here.pdf");

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? "GET";
      calls.push({ path, method, body: opts?.body });
      return lockStateResponse({
        holder_id: "u1",
        holder_name: "An",
        held_by_me: true,
      });
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? "GET";
      calls.push({ path, method, body: opts?.body });
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === `/api/v1/documents/${DOC_ID}/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-held-here",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-held-here/complete" && method === "POST") {
        return {
          upload_id: "up-held-here",
          checksum_sha256: "b".repeat(64),
          size_bytes: THRESHOLD + 1024,
          claim_expires_at: "2099-01-02T01:00:00Z",
        };
      }
      if (path === `/api/v1/documents/${DOC_ID}/versions/commit` && method === "POST") {
        return {
          document: createdFileDoc(DOC_ID),
          version: {
            id: "v2",
            document_id: DOC_ID,
            version: 2,
            kind: "file",
            reason: "upload",
            size_bytes: THRESHOLD + 1024,
            checksum_sha256: "b".repeat(64),
            created_at: "2026-10-18T01:05:00Z",
          },
        };
      }
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const partNum = Number(/part-(\d+)/.exec(url)?.[1] ?? "1");
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }),
    );

    registerHeldEditLock(DOC_ID, "lock-here-1");
    try {
      await openDialogAndSubmit(bigFile);
      await waitFor(() => {
        expect(calls.some((c) => c.path === `/api/v1/documents/${DOC_ID}/versions/commit`)).toBe(true);
      });
      expect(calls.some((c) => c.path === `/api/v1/documents/${DOC_ID}/edit-lock` && c.method === "GET")).toBe(true);
      const commitCall = calls.find((c) => c.path === `/api/v1/documents/${DOC_ID}/versions/commit`);
      expect(commitCall?.body).toEqual({
        upload_id: "up-held-here",
        base_revision: "1",
        edit_lock_id: "lock-here-1",
      });
    } finally {
      forgetHeldEditLock("lock-here-1");
    }
  });

  it("passes the pre-check when no edit lock is held", async () => {
    const calls: string[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "unheld.pdf");

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      return lockStateResponse(null);
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === `/api/v1/documents/${DOC_ID}/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-unheld",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-unheld/complete" && method === "POST") {
        return {
          upload_id: "up-unheld",
          checksum_sha256: "b".repeat(64),
          size_bytes: THRESHOLD + 1024,
          claim_expires_at: "2099-01-02T01:00:00Z",
        };
      }
      if (path === `/api/v1/documents/${DOC_ID}/versions/commit` && method === "POST") {
        return {
          document: createdFileDoc(DOC_ID),
          version: {
            id: "v2",
            document_id: DOC_ID,
            version: 2,
            kind: "file",
            reason: "upload",
            size_bytes: THRESHOLD + 1024,
            checksum_sha256: "b".repeat(64),
            created_at: "2026-10-18T01:05:00Z",
          },
        };
      }
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const partNum = Number(/part-(\d+)/.exec(url)?.[1] ?? "1");
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }),
    );

    await openDialogAndSubmit(bigFile);
    await waitFor(() => {
      expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/versions/commit`);
    });
    expect(calls).toContain(`GET /api/v1/documents/${DOC_ID}/edit-lock`);
    expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/upload-sessions`);
  });

  it("falls through to the server upload when the edit-lock pre-check read fails", async () => {
    const calls: string[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "lock-read-failed.pdf");

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      throw new ApiError("Internal Server Error", "internal_error", 500);
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === `/api/v1/documents/${DOC_ID}/upload-sessions` && method === "POST") {
        return {
          session_id: "sess-fallback",
          part_size: THRESHOLD,
          total_parts: 2,
          completed_parts: [],
          parts: makePartUrls([1, 2]),
          expires_at: "2099-01-02T00:00:00Z",
        };
      }
      if (path === "/api/v1/upload-sessions/sess-fallback/complete" && method === "POST") {
        return {
          upload_id: "up-fallback",
          checksum_sha256: "b".repeat(64),
          size_bytes: THRESHOLD + 1024,
          claim_expires_at: "2099-01-02T01:00:00Z",
        };
      }
      if (path === `/api/v1/documents/${DOC_ID}/versions/commit` && method === "POST") {
        return {
          document: createdFileDoc(DOC_ID),
          version: {
            id: "v2",
            document_id: DOC_ID,
            version: 2,
            kind: "file",
            reason: "upload",
            size_bytes: THRESHOLD + 1024,
            checksum_sha256: "b".repeat(64),
            created_at: "2026-10-18T01:05:00Z",
          },
        };
      }
      return {};
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const partNum = Number(/part-(\d+)/.exec(url)?.[1] ?? "1");
        return new Response(null, { status: 200, headers: { ETag: `"etag-${partNum}"` } });
      }),
    );

    await openDialogAndSubmit(bigFile);
    await waitFor(() => {
      expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/versions/commit`);
    });
    expect(calls).toContain(`GET /api/v1/documents/${DOC_ID}/edit-lock`);
    expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/upload-sessions`);
  });

  it("surfaces a create-time 423 document_locked as the locked copy with no resume record, no progress bar in the dialog, and no spinner toast on the drop path", async () => {
    const gateFields = {
      holder_id: "u2",
      holder_name: "Bình",
      since: "2026-10-18T01:00:00Z",
      expires_at: "2026-10-18T01:02:00Z",
      held_by_me: false,
      current_revision: "3",
    };
    const calls: string[] = [];
    const bigFile = makePdfFile(THRESHOLD + 1024, "create-423.pdf");
    const refused = vi.fn();
    const off = onWriteRefused(DOC_ID, refused);

    editLockRoute.mockImplementation(async () => lockStateResponse(null));

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === `/api/v1/documents/${DOC_ID}/upload-sessions` && method === "POST") {
        throw new ApiError("đang bị khóa", "document_locked", 423, undefined, gateFields);
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [MY_FOLDER_TREE_NODE] };
      if (path === `/api/v1/workspaces/${WS}/documents/upload-sessions` && method === "POST") {
        throw new ApiError("đang bị khóa", "document_locked", 423, undefined, gateFields);
      }
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents`)) return { documents: [], next_cursor: null };
      return {};
    });

    try {
      const { unmount } = render(wrap(<DocumentFileView wsId={WS} doc={createdFileDoc(DOC_ID)} readonly={false} />));
      fireEvent.click(screen.getByRole("button", { name: t("documents.file.new_version") }));
      await screen.findByText(t("documents.upload.size_hint", { max: "150 MB" }));
      const input = await screen.findByLabelText(t("documents.upload.pick"));
      fireEvent.change(input, { target: { files: [bigFile] } });
      fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t("documents.upload.document_locked"));
      expect(alert).not.toHaveTextContent(t("documents.upload.failed_resumable"));
      expect(alert).not.toHaveTextContent(t("documents.file.upload_failed"));
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("document-upload-resume-hint")).not.toBeInTheDocument();
      expect(findResumableUpload(defaultStorage, uploadFileKey(bigFile), VERSION_TARGET)).toBeNull();
      expect(refused).toHaveBeenCalledWith(gateFields, undefined);
      unmount();

      // Drop path: loading spinner toast is dismissed and locked error toast is shown.
      const loadingSpy = vi.spyOn(toast, "loading").mockReturnValue("drop-toast-423");
      const dismissSpy = vi.spyOn(toast, "dismiss").mockReturnValue("");
      const errorSpy = vi.spyOn(toast, "error").mockReturnValue("");

      calls.length = 0;
      renderPageView();
      await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
      await waitForUploadLimits();
      const dropRegion = screen.getByRole("region", { name: t("documents.page.title") });
      const droppedFile = makePdfFile(THRESHOLD + 1024, "dropped-423.pdf");
      fireEvent.drop(dropRegion, {
        dataTransfer: { types: ["Files"], files: [droppedFile] },
      });

      await waitFor(() => {
        expect(loadingSpy).toHaveBeenCalled();
        expect(dismissSpy).toHaveBeenCalledWith("drop-toast-423");
        expect(errorSpy).toHaveBeenCalledWith(t("documents.upload.document_locked"));
      });
      expect(
        findResumableUpload(defaultStorage, uploadFileKey(droppedFile), {
          kind: "workspace",
          workspaceId: WS,
        }),
      ).toBeNull();
    } finally {
      off();
    }
  });

  it("takes no edit-lock pre-check for small files at or below the chunked threshold", async () => {
    const calls: string[] = [];
    const smallFile = makePdfFile(THRESHOLD, "at-threshold.pdf");

    editLockRoute.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      return lockStateResponse(null);
    });

    requestMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      const method = opts?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path.startsWith("/api/v1/config")) return LIMITS_CONFIG;
      if (path.startsWith(`/api/v1/documents/${DOC_ID}/versions`) && method === "GET") {
        return { versions: [], next_cursor: null };
      }
      if (path === `/api/v1/documents/${DOC_ID}/uploads` && method === "POST") {
        return {
          upload_id: "up-small-1",
          checksum_sha256: "c".repeat(64),
          size_bytes: THRESHOLD,
          claim_expires_at: "2099-01-02T01:00:00Z",
        };
      }
      if (path === `/api/v1/documents/${DOC_ID}/versions/commit` && method === "POST") {
        return {
          document: createdFileDoc(DOC_ID),
          version: {
            id: "v2",
            document_id: DOC_ID,
            version: 2,
            kind: "file",
            reason: "upload",
            size_bytes: THRESHOLD,
            checksum_sha256: "c".repeat(64),
            created_at: "2026-10-18T01:05:00Z",
          },
        };
      }
      return {};
    });

    await openDialogAndSubmit(smallFile);
    await waitFor(() => {
      expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/versions/commit`);
    });
    expect(calls).toContain(`POST /api/v1/documents/${DOC_ID}/uploads`);
    expect(calls).not.toContain(`GET /api/v1/documents/${DOC_ID}/edit-lock`);
    expect(calls).not.toContain(`POST /api/v1/documents/${DOC_ID}/upload-sessions`);
  });
});


