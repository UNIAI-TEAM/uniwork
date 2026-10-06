import { createHash } from "node:crypto";
import type { DeploymentProfile } from "../../shared/deployment";
import { desktopDocumentFormatForMime, desktopDocumentFormatForName, desktopDocumentMimeTypes, desktopMimeTypeForFormat, desktopUntitledName, desktopExtensionsForFormat, type DesktopDocumentFormat } from "../../shared/document-formats";
import type { DesktopLibraryDocument, DesktopLibraryResponse, DesktopLibraryDownloadResponse, DesktopLibraryCreateResponse, DesktopOfficeOpenResponse, DesktopOfficeContextResponse, DesktopOfficeSaveResponse, DesktopOfficeJobResponse } from "../../shared/ipc";
import { sanitizeDesktopPublicFlags } from "../../shared/ipc";
import type { CredentialStore } from "../auth/credentials";
import type { DesktopOfficeTransport } from "../ipc";
import { assertOrigin } from "./auth-transport";
import { blankDocumentBytes } from "../files/blank-documents";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const JOB_POLL_MS = 1_000;
const JOB_TIMEOUT_MS = 120_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type MainOfficeTransport = DesktopOfficeTransport & Readonly<{
  readDocumentAccess(scope: { workspaceId: string; documentId: string }): Promise<"edit" | "none">;
}>;

export function createHttpOfficeTransport(options: { profile: DeploymentProfile; credentials: CredentialStore; fetchImpl?: FetchLike; refreshSession?: () => Promise<void> }): MainOfficeTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  assertOrigin(options.profile.apiOrigin, options.profile.channel === "dev");
  const origin = options.profile.apiOrigin.replace(/\/$/, "");
  let refreshInFlight: Promise<void> | undefined;
  const refreshOnce = async () => {
    if (!options.refreshSession) throw new Error("login_required");
    if (!refreshInFlight) refreshInFlight = options.refreshSession().finally(() => { refreshInFlight = undefined; });
    await refreshInFlight;
  };
  async function authRequest(path: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await options.credentials.get();
      if (!session || session.accountId.length === 0) throw new Error("login_required");
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("Authorization", `Bearer ${session.accessToken}`);
      const response = await fetchImpl(`${origin}/api/v1${path}`, { ...init, headers, cache: "no-store", redirect: "error" });
      if (response.ok) return response;
      if (response.status === 401 && attempt === 0) {
        try {
          const current = await options.credentials.get();
          if (!current || current.accountId !== session.accountId || current.deviceSessionId !== session.deviceSessionId) throw new Error("login_required");
          // A concurrent request may already have rotated this expired token.
          if (current.accessToken === session.accessToken) await refreshOnce();
          const refreshed = await options.credentials.get();
          if (!refreshed || refreshed.accountId !== session.accountId || refreshed.deviceSessionId !== session.deviceSessionId) throw new Error("login_required");
          continue;
        } catch { throw new Error("login_required"); }
      }
      // A 404 is its own code: the document was deleted or moved, which no retry fixes (the flag-gated upgrade stops on it).
      throw new Error(response.status === 401 ? "login_required" : response.status === 403 ? "forbidden" : response.status === 404 ? "office_document_gone" : "office_request_failed");
    }
    throw new Error("office_request_failed");
  }
  async function json(path: string, init?: RequestInit): Promise<unknown> { return (await authRequest(path, init)).json(); }
  /** The download response carries the authoritative format: its Content-Type
   * maps through the shared format table, and a generic octet-stream answer
   * falls back to the Content-Disposition file name's extension. */
  async function bytes(path: string): Promise<{ data: Uint8Array; filename: string; mimeType: string }> {
    const response = await authRequest(path, { headers: { Accept: desktopDocumentMimeTypes().join(", ") } });
    const data = new Uint8Array(await response.arrayBuffer());
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const dispositionName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const mimeType = response.headers.get("Content-Type")?.split(";", 1)[0] ?? "";
    const format = desktopDocumentFormatForMime(mimeType) ?? (dispositionName ? desktopDocumentFormatForName(dispositionName) : undefined);
    if (!format) throw new Error("document_format_unsupported");
    const filename = (dispositionName ?? desktopUntitledName(format)).replace(/[\\/\r\n]/g, "_");
    return { data, filename, mimeType: desktopMimeTypeForFormat(format) };
  }
  async function readDocumentDetail(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopLibraryDocument | undefined> {
    const raw = await json(`/documents/${encodeURIComponent(input.documentId)}`);
    const body = raw && typeof raw === "object" && "document" in raw ? (raw as { document: unknown }).document : raw;
    const document = toLibraryDocument(body, input.workspaceId);
    if (!document) return undefined;
    return input.version === undefined ? document : { ...document, version: input.version };
  }
  async function download(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopLibraryDownloadResponse> {
    void input.workspaceId;
    const path = `/documents/${encodeURIComponent(input.documentId)}/download${input.version === undefined ? "" : `?version=${input.version}`}`;
    const result = await bytes(path);
    return { documentId: input.documentId, version: input.version ?? 0, filename: result.filename, mimeType: result.mimeType, dataBase64: Buffer.from(result.data).toString("base64"), checksum: `sha256:${createHash("sha256").update(result.data).digest("hex")}` };
  }
  return Object.freeze({
    async readDocumentAccess(input: { workspaceId: string; documentId: string }): Promise<"edit" | "none"> {
      try {
        if (!input.workspaceId || !input.documentId) return "none";
        // List summaries intentionally omit access. This fresh authenticated
        // detail read is main-only and never downloads document bytes.
        const raw = await json(`/documents/${encodeURIComponent(input.documentId)}`);
        const value = raw && typeof raw === "object" && "document" in raw ? raw.document : raw;
        if (!value || typeof value !== "object" || Array.isArray(value)) return "none";
        const row = value as Record<string, unknown>;
        if (row.id !== input.documentId || row.workspace_id !== input.workspaceId) return "none";
        return row.my_level === "edit" || row.my_level === "manage" ? "edit" : "none";
      } catch { return "none"; }
    },
    async context() {
      const session = await options.credentials.get();
      if (!session) throw new Error("login_required");
      const [raw, profileRaw] = await Promise.all([json("/orgs"), json("/me")]);
      const person = profileRaw && typeof profileRaw === "object" && "user" in profileRaw ? profileRaw.user as Record<string, unknown> : {};
      const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const entries = (value: unknown) => Array.isArray(value) ? value.map((item) => item && typeof item === "object" ? { id: String((item as Record<string, unknown>).id ?? ""), name: String((item as Record<string, unknown>).name ?? "") } : null).filter((item): item is { id: string; name: string } => !!item && item.id.length > 0 && item.name.length > 0) : [];
      const organizations = entries(body.organizations);
      const workspaceResults = await Promise.all(organizations.map(async (organization) => {
        const result = await json(`/orgs/${encodeURIComponent(organization.id)}/workspaces`);
        const rows = result && typeof result === "object" ? (result as Record<string, unknown>).workspaces : [];
        return entries(rows).map((workspace) => ({ ...workspace, organizationId: organization.id }));
      }));
      return { deployments: [{ id: options.profile.deploymentId, name: new URL(options.profile.apiOrigin).host }], accounts: [{ id: session.accountId, name: typeof person.display_name === "string" && person.display_name ? person.display_name : "UniWork", ...(typeof person.email === "string" ? { email: person.email } : {}) }], organizations, workspaces: workspaceResults.flat() };
    },
    async publicConfig(organizationId?: string) {
      // Organization-scoped overrides only evaluate when the server is asked for that organization.
      const raw = await json(organizationId ? `/config?organization_id=${encodeURIComponent(organizationId)}` : "/config");
      return { flags: sanitizeDesktopPublicFlags(raw && typeof raw === "object" ? (raw as Record<string, unknown>).flags : undefined) };
    },
    async list(input: { workspaceId: string; cursor?: string; mode: "list" | "recent" | "search"; query?: string }): Promise<DesktopLibraryResponse> {
      const endpoint = input.mode === "recent" ? "recent" : "";
      const params = new URLSearchParams();
      if (input.query) params.set("q", input.query);
      if (input.cursor) params.set("cursor", input.cursor);
      params.set("limit", "50");
      params.set("kind", "file");
      const query = params.toString();
      const raw = await json(`/workspaces/${encodeURIComponent(input.workspaceId)}/documents${endpoint ? `/${endpoint}` : ""}${query ? `?${query}` : ""}`);
      const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rows = Array.isArray(body.documents) ? body.documents : [];
      const memberRaw = rows.length ? await json(`/workspaces/${encodeURIComponent(input.workspaceId)}/members`).catch(() => null) : null;
      const members = memberRaw && typeof memberRaw === "object" && "members" in memberRaw && Array.isArray(memberRaw.members) ? memberRaw.members : [];
      const ownerNames = new Map<string, string>();
      for (const member of members) if (member && typeof member === "object" && typeof member.user_id === "string" && typeof member.display_name === "string") ownerNames.set(member.user_id, member.display_name);
      const documents = rows.map((row) => toLibraryDocument(row, input.workspaceId)).filter((row): row is DesktopLibraryDocument => row !== undefined);
      for (const document of documents) {
        const row = rows.find((candidate) => candidate && typeof candidate === "object" && "id" in candidate && candidate.id === document.id);
        if (row && typeof row === "object" && "created_by" in row && typeof row.created_by === "string") document.ownerName = ownerNames.get(row.created_by);
      }
      const capabilities = documents[0] ? await json(`/documents/${encodeURIComponent(documents[0].id)}/office/capabilities`).catch(() => null) : null;
      const operations = capabilities && typeof capabilities === "object" && "operations" in capabilities && Array.isArray(capabilities.operations) ? capabilities.operations : [];
      const engineAvailable = operations.some((row: unknown) => !!row && typeof row === "object" && "operation" in row && row.operation === "open" && "supported" in row && row.supported === true);
      return { documents, nextCursor: typeof body.next_cursor === "string" ? body.next_cursor : null, engineAvailable };
    },
    async create(input: { workspaceId: string; title: string; format: DesktopDocumentFormat }): Promise<DesktopLibraryCreateResponse> {
      const form = new FormData();
      form.set("file", new Blob([blankDocumentBytes(input.format) as BlobPart], { type: desktopMimeTypeForFormat(input.format) }), input.title);
      form.set("title", input.title);
      const raw = await json(`/workspaces/${encodeURIComponent(input.workspaceId)}/documents/files`, {
        method: "POST",
        headers: { "Idempotency-Key": `desktop-create-${crypto.randomUUID()}` },
        body: form,
      });
      const body = raw && typeof raw === "object" && "document" in raw ? (raw as { document: unknown }).document : raw;
      const document = toLibraryDocument(body, input.workspaceId);
      if (!document) throw new Error("document_invalid");
      const downloaded = await download({ workspaceId: input.workspaceId, documentId: document.id, version: document.version });
      return { document, dataBase64: downloaded.dataBase64, filename: downloaded.filename, mimeType: downloaded.mimeType, checksum: downloaded.checksum };
    },
    download,
    // The server edit-job path for a carried non-docx format (xlsx today).
    // This is NOT a second save path: the job output is staged bytes, and the
    // existing desktop:office-save command still owns upload+commit. The
    // renderer never sees the engine address or a grant - main polls and
    // returns only the bounded output bytes plus the pinned job id.
    async officeJob(input: { workspaceId: string; documentId: string; format: DesktopDocumentFormat; operation: "open" | "edit"; baseRevision: string; edits?: readonly unknown[] }): Promise<DesktopOfficeJobResponse> {
      const base = `/documents/${encodeURIComponent(input.documentId)}/office/jobs`;
      const body = { operation: input.operation, format: input.format, base_revision: input.baseRevision, ...(input.edits === undefined ? {} : { edits: input.edits }) };
      const startRaw = await json(base, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `desktop-job-${crypto.randomUUID()}` }, body: JSON.stringify(body) });
      const start = startRaw && typeof startRaw === "object" ? startRaw as Record<string, unknown> : {};
      const jobId = typeof start.job_id === "string" ? start.job_id : undefined;
      if (!jobId) throw new Error("office_job_invalid");
      const deadline = Date.now() + JOB_TIMEOUT_MS;
      let job: Record<string, unknown> = start;
      while (job.state === "accepted" || job.state === "running") {
        if (Date.now() >= deadline) {
          await json(`${base}/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }).catch(() => undefined);
          throw new Error("office_job_timeout");
        }
        await sleep(JOB_POLL_MS);
        const next = await json(`${base}/${encodeURIComponent(jobId)}`);
        job = next && typeof next === "object" ? next as Record<string, unknown> : {};
      }
      const state = typeof job.state === "string" ? job.state : "failed";
      if (state !== "completed") {
        // Only the rule-set refusal (op positions, no document text) crosses to the renderer.
        const reason = job.error && typeof job.error === "object" ? (job.error as { reason?: unknown }).reason : undefined;
        const errorReason = typeof reason === "string" && reason.startsWith("xlsx_rule_sets_dropped:") ? reason.slice(0, 600) : undefined;
        return { jobId, documentId: input.documentId, state: state as DesktopOfficeJobResponse["state"], ...(errorReason === undefined ? {} : { errorReason }) };
      }
      const output = await authRequest(`${base}/${encodeURIComponent(jobId)}/output`, { headers: { Accept: "*/*" } });
      const data = new Uint8Array(await output.arrayBuffer());
      return { jobId, documentId: input.documentId, state: "completed", outputBase64: Buffer.from(data).toString("base64"), outputChecksum: `sha256:${createHash("sha256").update(data).digest("hex")}` };
    },
    async open(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeOpenResponse> {
      const [downloaded, document] = await Promise.all([download(input), readDocumentDetail(input)]);
      if (!document) throw new Error("document_invalid");
      return { document, dataBase64: downloaded.dataBase64, filename: downloaded.filename, mimeType: downloaded.mimeType, checksum: downloaded.checksum };
    },
    /** Metadata-only open: register the context for a format whose editor opens
     *  through the server job and never reads the raw bytes (no byte haul). */
    async openContext(input: { workspaceId: string; documentId: string; version?: number }): Promise<DesktopOfficeContextResponse> {
      const document = await readDocumentDetail(input);
      if (!document) throw new Error("document_invalid");
      return { document };
    },
    async save(input: { workspaceId: string; documentId: string; format: DesktopDocumentFormat; intentId: string; idempotencyKey: string; baseVersionId: string; baseRevision: string; dataBase64: string; checksum: string }): Promise<DesktopOfficeSaveResponse> {
      void input.workspaceId;
      void input.baseVersionId;
      const bytes = Buffer.from(input.dataBase64, "base64");
      const extension = desktopExtensionsForFormat(input.format)[0];
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: desktopMimeTypeForFormat(input.format) }), extension ? `document.${extension}` : "document");
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
  const format = desktopDocumentFormatForMime(mimeType) ?? desktopDocumentFormatForName(filename);
  if (!id || !title || !kind || !format) return undefined;
  const updatedAt = typeof row.updated_at === "string" && !Number.isNaN(Date.parse(row.updated_at)) ? new Date(row.updated_at).toISOString() : new Date(0).toISOString();
  return { id, workspaceId, title, kind, format, version: typeof row.current_version === "number" && Number.isSafeInteger(row.current_version) && row.current_version >= 0 ? row.current_version : 0, revision: typeof row.revision === "string" && /^\d+$/.test(row.revision) ? row.revision : "0", updatedAt, ownerKind: typeof row.owner_kind === "string" ? row.owner_kind : null, canEdit: row.my_level === "edit" || row.my_level === "manage", downloadAvailable: true };
}
