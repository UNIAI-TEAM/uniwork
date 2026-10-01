import { createHash } from "node:crypto";
import type { DeploymentProfile } from "../../shared/deployment";
import type { DesktopLibraryDocument, DesktopLibraryResponse, DesktopLibraryDownloadResponse, DesktopLibraryCreateResponse, DesktopOfficeOpenResponse, DesktopOfficeSaveResponse } from "../../shared/ipc";
import type { CredentialStore } from "../auth/credentials";
import type { DesktopOfficeTransport } from "../ipc";
import { assertOrigin } from "./auth-transport";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHttpOfficeTransport(options: { profile: DeploymentProfile; credentials: CredentialStore; fetchImpl?: FetchLike }): DesktopOfficeTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  assertOrigin(options.profile.apiOrigin, options.profile.channel === "dev");
  const origin = options.profile.apiOrigin.replace(/\/$/, "");
  async function authRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const session = await options.credentials.get();
    if (!session || session.accountId.length === 0) throw new Error("login_required");
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    const response = await fetchImpl(`${origin}/api/v1${path}`, { ...init, headers, cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : "office_request_failed");
    return response;
  }
  async function json(path: string, init?: RequestInit): Promise<unknown> { return (await authRequest(path, init)).json(); }
  async function bytes(path: string): Promise<{ data: Uint8Array; filename: string; mimeType: string }> {
    const response = await authRequest(path, { headers: { Accept: DOCX_MIME } });
    const data = new Uint8Array(await response.arrayBuffer());
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "document.docx";
    return { data, filename: filename.replace(/[\\/\r\n]/g, "_"), mimeType: response.headers.get("Content-Type")?.split(";", 1)[0] ?? DOCX_MIME };
  }
  async function download(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopLibraryDownloadResponse> {
    void input.workspaceId;
    const path = `/documents/${encodeURIComponent(input.documentId)}/download${input.version === undefined ? "" : `?version=${input.version}`}`;
    const result = await bytes(path);
    if (result.mimeType !== DOCX_MIME && result.mimeType !== "application/octet-stream") throw new Error("document_format_unsupported");
    return { documentId: input.documentId, version: input.version ?? 0, filename: result.filename, mimeType: DOCX_MIME, dataBase64: Buffer.from(result.data).toString("base64"), checksum: `sha256:${createHash("sha256").update(result.data).digest("hex")}` };
  }
  return Object.freeze({
    async context() {
      const session = await options.credentials.get();
      if (!session) throw new Error("login_required");
      const raw = await json("/orgs");
      const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const entries = (value: unknown) => Array.isArray(value) ? value.map((item) => item && typeof item === "object" ? { id: String((item as Record<string, unknown>).id ?? ""), name: String((item as Record<string, unknown>).name ?? "") } : null).filter((item): item is { id: string; name: string } => !!item && item.id.length > 0 && item.name.length > 0) : [];
      const organizations = entries(body.organizations);
      const workspaceResults = await Promise.all(organizations.map(async (organization) => {
        const result = await json(`/orgs/${encodeURIComponent(organization.id)}/workspaces`);
        const rows = result && typeof result === "object" ? (result as Record<string, unknown>).workspaces : [];
        return entries(rows);
      }));
      return { deployments: [{ id: options.profile.deploymentId, name: options.profile.deploymentId }], accounts: [{ id: session.accountId, name: session.accountId }], organizations, workspaces: workspaceResults.flat() };
    },
    async list(input: { workspaceId: string; cursor?: string; mode: "list" | "recent" | "search"; query?: string }): Promise<DesktopLibraryResponse> {
      const endpoint = input.mode === "recent" ? "recent" : "";
      const params = new URLSearchParams();
      if (input.query) params.set("q", input.query);
      if (input.cursor) params.set("cursor", input.cursor);
      params.set("limit", "50");
      const query = params.toString();
      const raw = await json(`/workspaces/${encodeURIComponent(input.workspaceId)}/documents${endpoint ? `/${endpoint}` : ""}${query ? `?${query}` : ""}`);
      const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rows = Array.isArray(body.documents) ? body.documents : [];
      const documents = rows.map((row) => toLibraryDocument(row, input.workspaceId)).filter((row): row is DesktopLibraryDocument => row !== undefined);
      return { documents, nextCursor: typeof body.next_cursor === "string" ? body.next_cursor : null, engineAvailable: true };
    },
    async create(input: { workspaceId: string; title: string }): Promise<DesktopLibraryCreateResponse> {
      const raw = await json(`/workspaces/${encodeURIComponent(input.workspaceId)}/documents/files/blank`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `desktop-create-${crypto.randomUUID()}` },
        body: JSON.stringify({ format: "docx", title: input.title }),
      });
      const body = raw && typeof raw === "object" && "document" in raw ? (raw as { document: unknown }).document : raw;
      const document = toLibraryDocument(body, input.workspaceId);
      if (!document) throw new Error("document_invalid");
      const downloaded = await download({ workspaceId: input.workspaceId, documentId: document.id, version: document.version });
      return { document, dataBase64: downloaded.dataBase64, filename: downloaded.filename, mimeType: DOCX_MIME, checksum: downloaded.checksum };
    },
    download,
    async open(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeOpenResponse> {
      const [downloaded, raw] = await Promise.all([download(input), json(`/documents/${encodeURIComponent(input.documentId)}`)]);
      const body = raw && typeof raw === "object" && "document" in raw ? (raw as { document: unknown }).document : raw;
      const document = toLibraryDocument(body, input.workspaceId);
      if (!document) throw new Error("document_invalid");
      return { document: { ...document, version: input.version ?? document.version }, dataBase64: downloaded.dataBase64, filename: downloaded.filename, mimeType: DOCX_MIME, checksum: downloaded.checksum };
    },
    async save(input: { workspaceId: string; documentId: string; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }): Promise<DesktopOfficeSaveResponse> {
      void input.workspaceId;
      void input.baseVersionId;
      const bytes = Buffer.from(input.dataBase64, "base64");
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: DOCX_MIME }), "document.docx");
      const uploadRaw = await (await authRequest(`/documents/${encodeURIComponent(input.documentId)}/uploads`, { method: "POST", body: form, headers: { "Idempotency-Key": input.idempotencyKey } })).json();
      const upload = uploadRaw && typeof uploadRaw === "object" && "upload" in uploadRaw ? (uploadRaw as { upload: Record<string, unknown> }).upload : uploadRaw as Record<string, unknown>;
      if (!upload || typeof upload.upload_id !== "string") throw new Error("upload_invalid");
      const commitRaw = await json(`/documents/${encodeURIComponent(input.documentId)}/versions/commit`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ upload_id: upload.upload_id, base_revision: input.baseRevision }) });
      const result = commitRaw && typeof commitRaw === "object" ? commitRaw as Record<string, unknown> : {};
      const version = result.version && typeof result.version === "object" ? result.version as Record<string, unknown> : {};
      const document = result.document && typeof result.document === "object" ? result.document as Record<string, unknown> : {};
      if (typeof version.id !== "string" || typeof document.revision !== "string") throw new Error("commit_invalid");
      const committedChecksum = typeof version.checksum_sha256 === "string" && /^sha256:[0-9a-f]{64}$/.test(version.checksum_sha256) ? version.checksum_sha256 : input.checksum;
      return { documentId: input.documentId, intentId: input.intentId, idempotencyKey: input.idempotencyKey, versionId: version.id, revision: document.revision, checksum: committedChecksum };
    },
  });
}

function toLibraryDocument(value: unknown, workspaceId: string): DesktopLibraryDocument | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const file = row.file && typeof row.file === "object" ? row.file as Record<string, unknown> : {};
  const id = typeof row.id === "string" ? row.id : undefined;
  const title = typeof row.title === "string" && row.title.trim() ? row.title : undefined;
  const kind = row.kind === "file" ? "file" : undefined;
  // DocumentSummaryDTO (list/recent/search) never carries `file` - only the
  // single-document GET (DocumentDTO) does. A list row's format is derived
  // from the title's extension instead, same as the upload filename it was
  // created from; a full `file` block (document open) still wins when present.
  const filename = typeof file.filename === "string" ? file.filename : (title ?? "");
  const mimeType = typeof file.mime_type === "string" ? file.mime_type : "";
  const format = mimeType === DOCX_MIME || /\.docx$/i.test(filename) ? "docx" : undefined;
  if (!id || !title || !kind || !format) return undefined;
  const updatedAt = typeof row.updated_at === "string" && !Number.isNaN(Date.parse(row.updated_at)) ? new Date(row.updated_at).toISOString() : new Date(0).toISOString();
  return { id, workspaceId, title, kind, format, version: typeof row.current_version === "number" && Number.isSafeInteger(row.current_version) && row.current_version >= 0 ? row.current_version : 0, revision: typeof row.revision === "string" && /^\d+$/.test(row.revision) ? row.revision : "0", updatedAt, ownerKind: typeof row.owner_kind === "string" ? row.owner_kind : null, canEdit: row.my_level === "edit" || row.my_level === "manage", downloadAvailable: true };
}
