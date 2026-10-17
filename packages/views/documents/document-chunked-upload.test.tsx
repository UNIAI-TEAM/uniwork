import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { saveResumableUpload, uploadFileKey } from "@uniwork/core/documents/chunked-upload";
import { forgetHeldEditLock, registerHeldEditLock } from "@uniwork/core/documents/edit-lock-registry";
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
import { DocumentFileView } from "./document-file-view";
import { DocumentsPageView } from "./documents-page-view";

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

beforeEach(() => {
  requestMock.mockReset();
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();

    await act(async () => {
      resolveComplete();
    });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d-large"));
    expect(calls).toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
    expect(calls).toContain("POST /api/v1/upload-sessions/sess-ws-1/complete");
    expect(calls).not.toContain(`POST /api/v1/workspaces/${WS}/documents/files`);
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
    fireEvent.click(pauseBtn);

    const resumeBtn = await screen.findByRole("button", { name: t("documents.upload.resume") });
    expect(resumeBtn).toBeInTheDocument();

    fireEvent.click(resumeBtn);
    await screen.findByRole("button", { name: t("documents.upload.pause") });
    expect(calls).toContain("GET /api/v1/upload-sessions/sess-pause");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.cancel") }));

    await waitFor(() => {
      expect(calls).toContain("DELETE /api/v1/upload-sessions/sess-pause");
    });
  });

  it("shows the resume hint when a picked file has an open resume record and resumes from completed parts", async () => {
    const bigFile = makePdfFile(THRESHOLD * 2, "resumable.pdf");
    const target = { kind: "workspace" as const, workspaceId: WS };
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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

  it("shows a loading toast with a Cancel action when dropping a file above threshold and suppresses toast.error on cancel", async () => {
    const calls: string[] = [];
    const loadingSpy = vi.spyOn(toast, "loading").mockReturnValue("drop-toast-1");
    const dismissSpy = vi.spyOn(toast, "dismiss").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "");

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
      if (path.startsWith(`/api/v1/workspaces/${WS}/documents/tree`)) return { documents: [] };
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
    await waitFor(() => {
      expect(calls.some((c) => c.startsWith("GET /api/v1/config"))).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const dropRegion = screen.getByRole("region", { name: t("documents.page.title") });
    const bigFile = makePdfFile(THRESHOLD * 2, "dropped-large.pdf");

    fireEvent.drop(dropRegion, {
      dataTransfer: { types: ["Files"], files: [bigFile] },
    });

    await waitFor(() => {
      expect(loadingSpy).toHaveBeenCalledWith(
        t("documents.upload.progress_status", { name: "dropped-large.pdf" }),
        expect.objectContaining({
          action: expect.objectContaining({
            label: t("documents.upload.cancel"),
          }),
        }),
      );
      expect(calls).toContain(`POST /api/v1/workspaces/${WS}/documents/upload-sessions`);
    });

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


