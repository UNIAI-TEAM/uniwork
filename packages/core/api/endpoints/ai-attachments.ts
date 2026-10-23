import { AskUploadedFileSchema, type AskUploadedFile } from "../../types/ai";
import { authedRequestHead, refreshSession, request, requestBlob, throwFromFailedResponse } from "../http";
import { parseWithFallback } from "../schema";
import { getAccessToken } from "../session";

export interface AskUploadOpts {
  /** Bytes the request body has handed to the network so far, of its total (0 when the browser cannot tell). */
  onProgress?: (loaded: number, total: number) => void;
  /** Aborting rejects with an AbortError; the server may or may not have stored the file by then. */
  signal?: AbortSignal;
}

const abortError = () => new DOMException("Aborted", "AbortError");

/**
 * POST a multipart body over XMLHttpRequest, the only transport that reports
 * upload progress. The request carries the same identity as `request` (see
 * `authedRequestHead`) and the answer becomes a Response, so a refusal maps to
 * the same ApiError through `throwFromFailedResponse`; a network failure is a
 * TypeError and an abort an AbortError, as with fetch.
 */
function postForm(path: string, body: FormData, opts: AskUploadOpts): Promise<Response> {
  const { signal, onProgress } = opts;
  const { url, headers } = authedRequestHead(path);
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    // A runtime may expose XMLHttpRequest without the upload side; the request then runs without progress.
    if (onProgress && xhr.upload) {
      xhr.upload.addEventListener("progress", (e) => onProgress(e.loaded, e.lengthComputable ? e.total : 0));
    }
    xhr.addEventListener("load", () => {
      cleanup();
      try {
        const responseHeaders = new Headers();
        for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
          const colon = line.indexOf(":");
          if (colon > 0) responseHeaders.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
        // 204/205/304 may not carry a body; a status of 0 (a blocked request) makes the constructor throw.
        const noBody = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
        resolve(
          new Response(noBody ? null : xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: responseHeaders,
          }),
        );
      } catch {
        reject(new TypeError("Failed to fetch"));
      }
    });
    xhr.addEventListener("error", () => {
      cleanup();
      reject(new TypeError("Failed to fetch"));
    });
    xhr.addEventListener("timeout", () => {
      cleanup();
      reject(new TypeError("Failed to fetch"));
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(abortError());
    });
    xhr.send(body);
  });
}

/**
 * Store one file for the asker's next question; the answer's `file_id` goes
 * in `attachment_ids`. A refusal rejects with the ApiError the server's code
 * rides on (`ai_attachments_unavailable`, `ai_attachments_too_large`,
 * `media_unsupported`, …). A 200 whose body is not an upload answer degrades
 * to an empty `file_id`, which the caller reads as a failed upload.
 */
export async function uploadAskAttachment(wsId: string, file: File, opts: AskUploadOpts = {}): Promise<AskUploadedFile> {
  const path = `/api/v1/workspaces/${wsId}/ai/attachments`;
  const body = new FormData();
  body.append("file", file);
  let res = await postForm(path, body, opts);
  // As in `request`: one refresh-and-retry when the access token has expired.
  if (res.status === 401 && getAccessToken() && (await refreshSession())) res = await postForm(path, body, opts);
  if (!res.ok) await throwFromFailedResponse(res);
  const raw: unknown = await res.json().catch(() => undefined);
  return parseWithFallback<AskUploadedFile>(
    raw,
    AskUploadedFileSchema,
    { file_id: "", name: file.name, mime: file.type, size: file.size, kind: "" },
    { endpoint: "POST /api/v1/workspaces/{workspaceID}/ai/attachments" },
  );
}

/** Drop an uploaded file that no question carries yet. */
export async function deleteAskAttachment(wsId: string, fileId: string): Promise<void> {
  await request(`/api/v1/workspaces/${wsId}/ai/attachments/${fileId}`, { method: "DELETE" });
}

/** The bytes of a file a sent question carries; `attachmentId` is the message's attachment `id`, not the upload's `file_id`. */
export function downloadAskAttachment(wsId: string, attachmentId: string): Promise<Blob> {
  return requestBlob(`/api/v1/workspaces/${wsId}/ai/attachments/${attachmentId}/content`);
}
