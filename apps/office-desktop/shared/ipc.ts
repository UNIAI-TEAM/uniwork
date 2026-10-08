import { z } from "zod";
import { DEFAULT_DESKTOP_DOCUMENT_FORMAT, DESKTOP_DOCUMENT_FORMATS, desktopDocumentMimeTypes, type DesktopDocumentFormat } from "./document-formats";
import { isAllowedExternalUrl } from "./external-url";
import { bytesSchema, isByteValue } from "./ipc-bytes";
import { desktopDeploymentImportResponseSchema, desktopDeploymentResetResponseSchema } from "./ipc-auth";
import { desktopPrintOptionsSchema, desktopPrintPreviewRequestSchema, desktopPrintPreviewResponseSchema, desktopPrintPrintersResponseSchema, desktopPrintResponseSchema, desktopPrintSavePdfRequestSchema, desktopPrintSavePdfResponseSchema, PRINT_HTML_MAX_BYTES } from "./ipc-print";

export { PRINT_HTML_MAX_BYTES, PRINT_PREVIEW_MAX_BYTES, desktopPrintPreviewResponseSchema, desktopPrintPrintersResponseSchema, desktopPrintResponseSchema, desktopPrintSavePdfResponseSchema, type DesktopPrinter, type DesktopPrintSavePdfResponse, type DesktopPrintGeometry, type DesktopPrintOptions, type DesktopPrintResponse } from "./ipc-print";
export * from "./ipc-auth";

/** The closed desktop wire surface. Keep this module free of Electron and
 * main-process imports so preload and renderer can consume only contracts. */
export const DESKTOP_IPC_CHANNELS = [
  "desktop:bootstrap",
  "desktop:engine-call",
  "desktop:open-external",
  "desktop:auth-start",
  "desktop:auth-cancel",
  "desktop:auth-session",
  "desktop:auth-config",
  "desktop:auth-logout",
  "desktop:deployment-import",
  "desktop:deployment-reset",
  "desktop:diagnostics",
  "desktop:window-theme",
  "desktop:appearance",
  "desktop:tabs-update",
  "desktop:file-pick-open",
  "desktop:file-create",
  "desktop:file-open",
  "desktop:file-save",
  "desktop:file-save-as",
  "desktop:file-xlsx",
  "desktop:draft-checkpoint",
  "desktop:draft-list",
  "desktop:draft-recover",
  "desktop:draft-discard",
  "desktop:local-state",
  "desktop:local-mode",
  "desktop:recent-list",
  "desktop:recent-open",
  "desktop:recent-remove",
  "desktop:library-list",
  "desktop:library-context",
  "desktop:public-config",
  "desktop:library-recent",
  "desktop:library-search",
  "desktop:library-create",
  "desktop:library-download",
  "desktop:office-open",
  "desktop:office-context",
  "desktop:office-save",
  "desktop:office-job",
  "desktop:leave-resolved",
  "desktop:print-document",
  "desktop:print-preview",
  "desktop:print-printers",
  "desktop:print-save-pdf",
] as const;
export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[number];
/** Main-to-renderer events are a separate, equally narrow allowlist. Event
 * payloads are parsed in main before send and again in preload. */
export const DESKTOP_EVENTS = ["desktop:launch-requested", "desktop:auth-session-changed", "desktop:office-save-requested", "desktop:office-print-requested", "desktop:file-open-requested", "desktop:leave-requested", "desktop:leave-expired", "desktop:login-requested", "desktop:theme-changed"] as const;
const sessionGenerationSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "invalid session generation");
const opaqueHandleSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/, "invalid opaque handle");
const operationSchema = z.enum(["capability", "open", "edit", "render", "text", "close", "serialize", "cancel"]);
const originSchema = z.string().url().max(2048);
const deploymentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid deployment");
const clientIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid client id");
const attemptIdSchema = z.string().regex(/^attempt_[A-Za-z0-9_-]{32,160}$/, "invalid attempt id");
const fileHandleSchema = z.string().regex(/^file_[A-Za-z0-9_-]{32,160}$/, "invalid file handle");
export const fileOpenRequestedSchema = z.object({ handle: fileHandleSchema }).strict();
const draftIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/, "invalid draft id");
/** Engine-call arguments: free-form, except that `data` (the document's own
 * bytes) must be binary and arrives as an exact Uint8Array. */
const engineArgsSchema = z.record(z.string(), z.unknown()).default({}).transform((args, ctx) => {
  if (!("data" in args)) return args;
  const data = bytesSchema.safeParse(args.data);
  if (!data.success) { ctx.addIssue({ code: "custom", message: "invalid byte field", path: ["data"] }); return z.NEVER; }
  return { ...args, data: data.data };
});
const documentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid document id");
export const desktopFileMetadataSchema = z.object({
  handle: fileHandleSchema,
  name: z.string().min(1).max(255),
  byteLength: z.number().int().nonnegative(),
  modifiedAtMs: z.number().finite().nonnegative(),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** A new local document has no backing path until its first Save As. */
  untitled: z.boolean().optional(),
}).strict();
/** Why a `desktop:file-*` command failed: a stable `[a-z0-9_]` code (never an OS
 * message or a path). An unknown code is still valid; the renderer falls back to
 * its generic copy for it. */
const fileFailureCodeSchema = z.string().regex(/^[a-z0-9_]{1,64}$/);
export const desktopFileResponseSchema = z.object({ opened: z.boolean(), metadata: desktopFileMetadataSchema.optional(), data: bytesSchema.optional(), missing: z.boolean().optional(), unsupported: z.boolean().optional(), code: fileFailureCodeSchema.optional() }).strict()
  // A code names a refusal: main never sends one with a successful open.
  .refine((value) => value.code === undefined || !value.opened, "a code belongs to a refused answer");
const recentFileIdSchema = z.string().regex(/^recent_[A-Za-z0-9]{16,64}$/, "invalid recent file id");
export const recentFileSchema = z.object({
  id: recentFileIdSchema,
  name: z.string().min(1).max(255),
  directory: z.string().max(1024),
  modifiedAtMs: z.number().finite().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  missing: z.boolean(),
}).strict();
export type RecentFile = z.infer<typeof recentFileSchema>;
export const recentFilesResponseSchema = z.object({ files: z.array(recentFileSchema) }).strict();
export const recentRemoveResponseSchema = z.object({ removed: z.boolean() }).strict();
export const localStateResponseSchema = z.object({ localMode: z.boolean() }).strict();
export const loginRequestedEventSchema = z.object({ reason: z.enum(["signed_out", "deployment_mismatch", "account_mismatch"]) }).strict();
export type LoginRequestedEvent = z.infer<typeof loginRequestedEventSchema>;
export const desktopDraftResponseSchema = z.object({ stored: z.boolean(), generation: z.number().int().positive() }).strict();
const draftBaseSchema = z.object({ revision: z.string().min(1), version: z.string().min(1) }).strict();
const draftIdentitySchema = z.object({
  deploymentId: deploymentSchema,
  accountId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
  base: draftBaseSchema,
}).strict();
const draftMetadataSchema = z.object({
  draftId: draftIdSchema,
  identity: draftIdentitySchema,
  generation: z.number().int().positive(),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  byteLength: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export const desktopDraftListResponseSchema = z.object({ drafts: z.array(draftMetadataSchema), locked: z.boolean().optional() }).strict();
export type DesktopDraftMetadata = z.infer<typeof draftMetadataSchema>;
export const desktopDraftRecoveryResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recovered"), metadata: draftMetadataSchema, data: bytesSchema }).strict(),
  z.object({ status: z.literal("missing") }).strict(),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(draftMetadataSchema) }).strict(),
  z.object({ status: z.literal("conflict"), metadata: draftMetadataSchema, currentBase: draftBaseSchema, draftBase: draftBaseSchema }).strict(),
  z.object({ status: z.literal("blocked"), metadata: draftMetadataSchema, reason: z.literal("edit_acl_missing") }).strict(),
  z.object({ status: z.literal("locked"), metadata: draftMetadataSchema.optional(), code: z.literal("draft_recovery_locked") }).strict(),
]);
export const desktopDraftDiscardResponseSchema = z.object({ discarded: z.boolean() }).strict();
const documentKindSchema = z.literal("file");
const documentFormatSchema = z.enum(DESKTOP_DOCUMENT_FORMATS as [DesktopDocumentFormat, ...DesktopDocumentFormat[]]);
const documentMimeTypeSchema = z.enum(desktopDocumentMimeTypes() as [string, ...string[]]);
const libraryDocumentSchema = z.object({
  id: documentIdSchema,
  workspaceId: opaqueHandleSchema,
  title: z.string().min(1).max(512),
  kind: documentKindSchema,
  format: documentFormatSchema,
  version: z.number().int().nonnegative(),
  revision: z.string().regex(/^\d+$/),
  updatedAt: z.string().datetime({ offset: true }),
  ownerKind: z.string().nullable(),
  ownerName: z.string().optional(),
  canEdit: z.boolean(),
  downloadAvailable: z.boolean(),
}).strict();
export type DesktopLibraryDocument = z.infer<typeof libraryDocumentSchema>;
export const desktopLibraryResponseSchema = z.object({
  documents: z.array(libraryDocumentSchema),
  nextCursor: z.string().nullable(),
  engineAvailable: z.boolean(),
}).strict();
export type DesktopLibraryResponse = z.infer<typeof desktopLibraryResponseSchema>;
const pickerEntrySchema = z.object({ id: opaqueHandleSchema, name: z.string().min(1).max(256), email: z.string().optional(), organizationId: opaqueHandleSchema.optional() }).strict();
export const desktopLibraryContextResponseSchema = z.object({
  deployments: z.array(pickerEntrySchema),
  accounts: z.array(pickerEntrySchema),
  organizations: z.array(pickerEntrySchema),
  workspaces: z.array(pickerEntrySchema),
}).strict();
export type DesktopLibraryContextResponse = z.infer<typeof desktopLibraryContextResponseSchema>;
/** The public feature flags GET /api/v1/config answers (boolean flags only,
 * bounded). Main fetches them with the session; the renderer never calls the API. */
const PUBLIC_FLAG_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const PUBLIC_FLAG_LIMIT = 128;
export const desktopPublicConfigResponseSchema = z.object({
  flags: z.record(z.string().regex(PUBLIC_FLAG_KEY), z.boolean()).refine((flags) => Object.keys(flags).length <= PUBLIC_FLAG_LIMIT, "too many flags"),
}).strict();
/** Keeps only well-formed boolean flags, at most the schema's cap, so a
 * larger catalogue degrades to a truncated answer instead of a rejected one.
 * The Office keys (office_engine first) are kept before any other, so a
 * catalogue past the cap never drops the flags the desktop gates on. */
export function sanitizeDesktopPublicFlags(raw: unknown): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return flags;
  const rank = (key: string) => (key === "office_engine" ? 0 : key.startsWith("office_") ? 1 : 2);
  const entries = Object.entries(raw).sort(([a], [b]) => rank(a) - rank(b));
  for (const [key, value] of entries) {
    if (Object.keys(flags).length >= PUBLIC_FLAG_LIMIT) break;
    if (typeof value === "boolean" && PUBLIC_FLAG_KEY.test(key)) flags[key] = value;
  }
  return flags;
}
export type DesktopPublicConfigResponse = z.infer<typeof desktopPublicConfigResponseSchema>;
export const desktopLibraryDownloadResponseSchema = z.object({
  documentId: documentIdSchema,
  version: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  mimeType: documentMimeTypeSchema,
  data: bytesSchema,
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();
export type DesktopLibraryDownloadResponse = z.infer<typeof desktopLibraryDownloadResponseSchema>;
export const desktopOfficeOpenResponseSchema = z.object({
  document: libraryDocumentSchema,
  data: bytesSchema,
  filename: z.string().min(1).max(255),
  mimeType: documentMimeTypeSchema,
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();
export type DesktopOfficeOpenResponse = z.infer<typeof desktopOfficeOpenResponseSchema>;
export type DesktopLibraryCreateResponse = DesktopOfficeOpenResponse;
/** A metadata-only open: it registers the main-owned document context without
 *  downloading bytes. The xlsx editor opens through the server job and never
 *  reads the raw bytes, so a cloud xlsx open uses this instead of office-open. */
export const desktopOfficeContextResponseSchema = z.object({ document: libraryDocumentSchema }).strict();
export type DesktopOfficeContextResponse = z.infer<typeof desktopOfficeContextResponseSchema>;
export const desktopOfficeSaveResponseSchema = z.object({
  documentId: documentIdSchema,
  intentId: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(160),
  versionId: z.string().min(1).max(160),
  revision: z.string().regex(/^\d+$/),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();
export type DesktopOfficeSaveResponse = z.infer<typeof desktopOfficeSaveResponseSchema>;
/** The server office-job surface for a carried non-docx format (xlsx today).
 *  The renderer names only ids, a carried format, a bounded operation and the
 *  op list; main owns the bearer token, the base revision and every network
 *  call. The edits list stays opaque here: main validates the envelope only,
 *  and the engine op parser on the server validates each op. */
export const desktopOfficeJobOperationSchema = z.enum(["open", "edit"]);
export const desktopOfficeJobRequestSchema = z.object({
  sessionGeneration: sessionGenerationSchema,
  workspaceId: opaqueHandleSchema,
  documentId: documentIdSchema,
  format: documentFormatSchema,
  operation: desktopOfficeJobOperationSchema,
  baseRevision: z.string().regex(/^\d+$/),
  edits: z.array(z.record(z.string(), z.unknown())).max(10_000).optional(),
}).strict();
export type DesktopOfficeJobRequest = z.infer<typeof desktopOfficeJobRequestSchema>;
export const desktopOfficeJobResponseSchema = z.object({
  jobId: z.string().min(1).max(160),
  documentId: documentIdSchema,
  state: z.enum(["accepted", "running", "completed", "failed", "timed_out", "cancelled", "crashed"]),
  /** The JSON snapshot (open) or the produced bytes (edit), bytes. */
  output: bytesSchema.optional(),
  outputChecksum: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  /** Only the engine's `xlsx_rule_sets_dropped:` refusal (op positions, no document text). */
  errorReason: z.string().max(600).optional(),
}).strict();
export type DesktopOfficeJobResponse = z.infer<typeof desktopOfficeJobResponseSchema>;
/** The local xlsx engine job (C1b): the SAME shape as the cloud office-job
 *  response, but keyed by an opaque local file handle instead of a workspace
 *  document. Main owns the bytes and the bundled IronCalc sidecar + xlsx
 *  gateway; the renderer never names a path, an engine or a grant. */
export const desktopFileXlsxRequestSchema = z.object({
  sessionGeneration: sessionGenerationSchema,
  handle: fileHandleSchema,
  operation: desktopOfficeJobOperationSchema,
  baseRevision: z.string().regex(/^\d+$/),
  edits: z.array(z.record(z.string(), z.unknown())).max(10_000).optional(),
}).strict();
export type DesktopFileXlsxRequest = z.infer<typeof desktopFileXlsxRequestSchema>;
export const desktopFileXlsxResponseSchema = z.object({
  state: z.enum(["completed", "failed"]),
  /** The JSON snapshot (open) or the produced bytes (edit), bytes. */
  output: bytesSchema.optional(),
  outputChecksum: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  /** Set on a `failed` answer that main can name (a refused file, not an engine fault). */
  code: fileFailureCodeSchema.optional(),
}).strict().refine((value) => value.code === undefined || value.state === "failed", "a code belongs to a failed answer");
export type DesktopFileXlsxResponse = z.infer<typeof desktopFileXlsxResponseSchema>;
export const desktopLeaveResolvedResponseSchema = z.object({ resolved: z.boolean() }).strict();
export type LeaveChoice = "save" | "keep" | "discard" | "stay";
export const leaveRequestedEventSchema = z.object({ requestId: opaqueHandleSchema, reason: z.enum(["close", "logout", "update"]) }).strict();
export type LeaveRequestedEvent = z.infer<typeof leaveRequestedEventSchema>;
export const leaveExpiredEventSchema = z.object({ requestId: opaqueHandleSchema }).strict();
export type LeaveExpiredEvent = z.infer<typeof leaveExpiredEventSchema>;
export const desktopDiagnosticsResponseSchema = z.object({
  name: z.string().min(1).optional(),
  appId: z.string().min(1),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-(?:dev|beta)\.\d+)?$/),
  engineVersion: z.string().min(1),
  contractVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  channel: z.enum(["stable", "beta", "dev"]),
  buildId: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
  deploymentId: deploymentSchema.optional(),
  originHost: z.string().min(1).max(255).optional(),
}).strict();
/** `resettable` marks a profile the user imported (userData), which the card
 * may offer to reset; an installer-owned profile is never resettable. */
export const desktopAuthConfigResponseSchema = z.object({ clientId: clientIdSchema, deploymentId: deploymentSchema, resettable: z.boolean().optional() }).strict();
export const desktopTabsUpdateResponseSchema = z.object({ updated: z.boolean() }).strict();
/** BCP 47 tags as the OS reports them ("vi-VN", "en-US"); the renderer picks
 * the first one the shared i18n dictionaries support. */
const languageTagSchema = z.string().regex(/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8}){0,4}$/);
export const desktopAppearanceResponseSchema = z.object({ dark: z.boolean(), languages: z.array(languageTagSchema).max(16) }).strict();
export type DesktopAppearance = z.infer<typeof desktopAppearanceResponseSchema>;
export const themeChangedEventSchema = z.object({ dark: z.boolean() }).strict();
export type ThemeChangedEvent = z.infer<typeof themeChangedEventSchema>;
const responseSchemas: Partial<Record<DesktopIpcChannel, z.ZodTypeAny>> = {
  "desktop:file-pick-open": desktopFileResponseSchema,
  "desktop:file-create": desktopFileResponseSchema,
  "desktop:file-open": desktopFileResponseSchema,
  "desktop:file-save": desktopFileResponseSchema,
  "desktop:file-save-as": desktopFileResponseSchema,
  "desktop:draft-checkpoint": desktopDraftResponseSchema,
  "desktop:draft-list": desktopDraftListResponseSchema,
  "desktop:draft-recover": desktopDraftRecoveryResponseSchema,
  "desktop:draft-discard": desktopDraftDiscardResponseSchema,
  "desktop:local-state": localStateResponseSchema,
  "desktop:local-mode": localStateResponseSchema,
  "desktop:recent-list": recentFilesResponseSchema,
  "desktop:recent-open": desktopFileResponseSchema,
  "desktop:recent-remove": recentRemoveResponseSchema,
  "desktop:diagnostics": desktopDiagnosticsResponseSchema,
  "desktop:deployment-import": desktopDeploymentImportResponseSchema,
  "desktop:deployment-reset": desktopDeploymentResetResponseSchema,
  "desktop:window-theme": z.object({ applied: z.boolean() }).strict(),
  "desktop:appearance": desktopAppearanceResponseSchema,
  "desktop:tabs-update": desktopTabsUpdateResponseSchema,
  "desktop:library-list": desktopLibraryResponseSchema,
  "desktop:library-context": desktopLibraryContextResponseSchema,
  "desktop:public-config": desktopPublicConfigResponseSchema,
  "desktop:library-recent": desktopLibraryResponseSchema,
  "desktop:library-search": desktopLibraryResponseSchema,
  "desktop:library-create": desktopOfficeOpenResponseSchema,
  "desktop:library-download": desktopLibraryDownloadResponseSchema,
  "desktop:office-open": desktopOfficeOpenResponseSchema,
  "desktop:office-context": desktopOfficeContextResponseSchema,
  "desktop:office-save": desktopOfficeSaveResponseSchema,
  "desktop:office-job": desktopOfficeJobResponseSchema,
  "desktop:file-xlsx": desktopFileXlsxResponseSchema,
  "desktop:leave-resolved": desktopLeaveResolvedResponseSchema,
  "desktop:print-document": desktopPrintResponseSchema,
  "desktop:print-preview": desktopPrintPreviewResponseSchema,
  "desktop:print-printers": desktopPrintPrintersResponseSchema,
  "desktop:print-save-pdf": desktopPrintSavePdfResponseSchema,
};
export const launchRequestedEventSchema = z.object({ documentId: documentIdSchema, operation: z.enum(["view", "edit"]), version: z.number().int().nonnegative().optional() }).strict();
export type LaunchRequestedEvent = z.infer<typeof launchRequestedEventSchema>;
export const officeSaveRequestedEventSchema = z.object({ documentId: opaqueHandleSchema }).strict();
export type OfficeSaveRequestedEvent = z.infer<typeof officeSaveRequestedEventSchema>;
/** Ctrl/Cmd+P pressed anywhere in the window, frames included (main/print-shortcut.ts): print the open document. Carries nothing. */
export const officePrintRequestedEventSchema = z.object({}).strict();
export const desktopSessionMetadataSchema = z.object({
  status: z.enum(["signed-out", "pending", "signed-in", "locked", "login-required"]),
  /** Why the store is locked when the host can name it; today only a missing
   * Linux Secret Service keyring, which the UI answers with its own fix hint. */
  lockedReason: z.enum(["keyring"]).optional(),
  accountId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
  deploymentId: deploymentSchema.optional(),
  organizationId: opaqueHandleSchema.optional(),
  workspaceId: opaqueHandleSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "signed-in" && (!value.accountId || !value.deploymentId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "signed-in metadata requires account and deployment" });
  if (value.status !== "signed-in" && (value.accountId !== undefined || value.deploymentId !== undefined || value.organizationId !== undefined || value.workspaceId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "non-signed-in metadata cannot include account" });
  if (value.lockedReason !== undefined && value.status !== "locked") context.addIssue({ code: z.ZodIssueCode.custom, message: "lockedReason requires the locked status" });
});
export type DesktopSessionMetadata = z.infer<typeof desktopSessionMetadataSchema>;
const requestSchemas = {
  "desktop:bootstrap": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:engine-call": z.object({ sessionGeneration: sessionGenerationSchema, operation: operationSchema, handle: opaqueHandleSchema, args: engineArgsSchema }).strict(),
  "desktop:open-external": z.object({ sessionGeneration: sessionGenerationSchema, url: z.string().url().max(2048) }).strict(),
  "desktop:auth-start": z.object({ sessionGeneration: sessionGenerationSchema, clientId: clientIdSchema, deploymentId: deploymentSchema }).strict(),
  "desktop:auth-cancel": z.object({ sessionGeneration: sessionGenerationSchema, attemptId: attemptIdSchema }).strict(),
  "desktop:auth-session": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:auth-config": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:auth-logout": z.object({ sessionGeneration: sessionGenerationSchema, scope: z.enum(["device", "family"]).default("device") }).strict(),
  "desktop:deployment-import": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:deployment-reset": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:diagnostics": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:window-theme": z.object({ sessionGeneration: sessionGenerationSchema, dark: z.boolean() }).strict(),
  "desktop:appearance": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:tabs-update": z.object({ sessionGeneration: sessionGenerationSchema, documentIds: z.array(opaqueHandleSchema).max(8), activeDocumentId: opaqueHandleSchema.nullable() }).strict().refine((value) => new Set(value.documentIds).size === value.documentIds.length && (value.activeDocumentId === null || value.documentIds.includes(value.activeDocumentId)), "invalid tab membership"),
  "desktop:file-pick-open": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:file-create": z.object({ sessionGeneration: sessionGenerationSchema, format: documentFormatSchema.default(DEFAULT_DESKTOP_DOCUMENT_FORMAT) }).strict(),
  "desktop:file-open": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema }).strict(),
  "desktop:file-save": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema, data: bytesSchema }).strict(),
  "desktop:file-save-as": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema, data: bytesSchema }).strict(),
  "desktop:local-state": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:local-mode": z.object({ sessionGeneration: sessionGenerationSchema, local: z.boolean() }).strict(),
  "desktop:recent-list": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:recent-open": z.object({ sessionGeneration: sessionGenerationSchema, id: recentFileIdSchema }).strict(),
  "desktop:recent-remove": z.object({ sessionGeneration: sessionGenerationSchema, id: recentFileIdSchema }).strict(),
  "desktop:draft-checkpoint": z.object({ sessionGeneration: sessionGenerationSchema, documentId: opaqueHandleSchema, draftId: draftIdSchema, generation: z.number().int().positive(), data: bytesSchema }).strict(),
  "desktop:draft-list": z.object({ sessionGeneration: sessionGenerationSchema, documentId: opaqueHandleSchema.optional() }).strict(),
  "desktop:draft-recover": z.object({ sessionGeneration: sessionGenerationSchema, documentId: opaqueHandleSchema, draftId: draftIdSchema, currentBase: draftBaseSchema }).strict(),
  "desktop:draft-discard": z.object({ sessionGeneration: sessionGenerationSchema, documentId: opaqueHandleSchema.optional(), draftId: draftIdSchema, generation: z.number().int().positive() }).strict(),
  "desktop:library-list": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, cursor: z.string().max(512).optional() }).strict(),
  "desktop:library-context": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:public-config": z.object({ sessionGeneration: sessionGenerationSchema, organizationId: opaqueHandleSchema.optional() }).strict(),
  "desktop:library-recent": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, cursor: z.string().max(512).optional() }).strict(),
  "desktop:library-search": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, query: z.string().trim().min(1).max(256), cursor: z.string().max(512).optional() }).strict(),
  "desktop:library-create": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, title: z.string().trim().min(1).max(255), format: documentFormatSchema.default(DEFAULT_DESKTOP_DOCUMENT_FORMAT) }).strict(),
  "desktop:library-download": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, documentId: documentIdSchema, version: z.number().int().nonnegative().optional() }).strict(),
  "desktop:office-open": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, documentId: documentIdSchema, version: z.number().int().nonnegative().optional() }).strict(),
  "desktop:office-context": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, documentId: documentIdSchema, version: z.number().int().nonnegative().optional() }).strict(),
  "desktop:office-job": desktopOfficeJobRequestSchema,
  "desktop:file-xlsx": desktopFileXlsxRequestSchema,
  "desktop:office-save": z.object({ sessionGeneration: sessionGenerationSchema, workspaceId: opaqueHandleSchema, documentId: documentIdSchema, format: documentFormatSchema, intentId: z.string().min(1).max(160), idempotencyKey: z.string().min(1).max(160), baseVersionId: z.string().min(1).max(160), baseRevision: z.string().regex(/^\d+$/), data: bytesSchema, checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict(),
  "desktop:leave-resolved": z.object({ sessionGeneration: sessionGenerationSchema, requestId: opaqueHandleSchema, choice: z.enum(["save", "keep", "discard", "stay"]), proceeded: z.boolean() }).strict(),
  "desktop:print-document": z.object({ sessionGeneration: sessionGenerationSchema, title: z.string().max(255), html: z.string().min(1).max(PRINT_HTML_MAX_BYTES), options: desktopPrintOptionsSchema.optional() }).strict(),
  "desktop:print-preview": desktopPrintPreviewRequestSchema,
  "desktop:print-printers": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:print-save-pdf": desktopPrintSavePdfRequestSchema,
} as const;
export type DesktopIpcRequest<C extends DesktopIpcChannel = DesktopIpcChannel> = z.infer<(typeof requestSchemas)[C]>;
export type IpcSenderContext = { senderId: number; frameId: number; origin: string; expectedSenderId: number; expectedFrameId: number; expectedOrigin: string; sessionGeneration: string; allowedExternalHosts?: readonly string[] };
export type IpcValidationErrorCode = "unknown_channel" | "oversize" | "sender" | "frame" | "origin" | "session" | "schema" | "external_url";
export class IpcValidationError extends Error { readonly code: IpcValidationErrorCode; constructor(code: IpcValidationErrorCode, message: string) { super(message); this.name = "IpcValidationError"; this.code = code; } }
export const IPC_MAX_BYTES = 64 * 1024;
/** Channels whose root `data` field is the file's own bytes. */
const BYTE_ROOT_CHANNELS: ReadonlySet<string> = new Set(["desktop:file-save", "desktop:file-save-as", "desktop:draft-checkpoint", "desktop:office-save"]);
/** True where binary file bytes may sit outside the JSON budget: root `data`
 * on a byte channel, or `args.data` of an engine call. Nowhere else. */
function isByteSlot(channel: string, key: string, depth: number, parentKey: string | undefined): boolean {
  if (key !== "data") return false;
  if (depth === 0) return BYTE_ROOT_CHANNELS.has(channel);
  return depth === 1 && channel === "desktop:engine-call" && parentKey === "args";
}
/** JSON bytes of a string. Every string on the wire is bounded by the channel
 * cap, so a longer one is refused without being measured. */
function stringBytes(value: string, maxBytes: number, encoder: TextEncoder): number {
  if (value.length > maxBytes) return maxBytes + 1;
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/** Measure the JSON wire representation without accepting values that
 * Electron's structured-clone transport can carry outside JSON. A bounded,
 * recursive walk rejects ArrayBuffer/Blob/Map/Set, class instances, cycles,
 * non-finite numbers and deeply nested values before schema parsing. Byte
 * fields (see isByteSlot) are exempt from the budget. */
function sizeInBytes(channel: string, value: unknown, maxBytes = IPC_MAX_BYTES): number {
  const encoder = new TextEncoder();
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number, parentKey?: string): number => {
    if (depth > 256) return maxBytes + 1;
    if (current === null) return 4;
    switch (typeof current) {
      case "boolean": return current ? 4 : 5;
      case "string": return stringBytes(current, maxBytes, encoder);
      case "number": return Number.isFinite(current) ? encoder.encode(String(current)).byteLength : maxBytes + 1;
      case "object": break;
      default: return maxBytes + 1;
    }
    if (seen.has(current)) return maxBytes + 1;
    seen.add(current);
    let total = Array.isArray(current) ? 2 : 2;
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        total += (index === 0 ? 0 : 1) + visit(current[index], depth + 1);
        if (total > maxBytes) return total;
      }
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return maxBytes + 1;
      for (const [key, child] of Object.entries(current)) {
        if (isByteSlot(channel, key, depth, parentKey) && isByteValue(child)) { total += encoder.encode(JSON.stringify(key)).byteLength + 1; continue; }
        total += encoder.encode(JSON.stringify(key)).byteLength + 1 + visit(child, depth + 1, key);
        if (total > maxBytes) return total;
      }
    }
    return total;
  };
  return visit(value, 0);
}
function isDesktopIpcChannel(value: string): value is DesktopIpcChannel { return (DESKTOP_IPC_CHANNELS as readonly string[]).includes(value); }
export function validateIpcRequest<C extends DesktopIpcChannel>(channel: C | string, payload: unknown, sender: IpcSenderContext): DesktopIpcRequest<C> {
  if (!isDesktopIpcChannel(channel)) throw new IpcValidationError("unknown_channel", "IPC channel is not allowlisted");
  if (sender.senderId !== sender.expectedSenderId) throw new IpcValidationError("sender", "IPC sender is not the bound webContents");
  if (sender.frameId !== sender.expectedFrameId) throw new IpcValidationError("frame", "IPC frame is not the bound frame");
  if (sender.origin !== sender.expectedOrigin || !originSchema.safeParse(sender.origin).success) throw new IpcValidationError("origin", "IPC origin is not the application origin");
  // Every request keeps the small control cap, byte fields excepted (see
  // sizeInBytes); print HTML has its own cap.
  const byteLimit = channel === "desktop:print-document" || channel === "desktop:print-preview" || channel === "desktop:print-save-pdf" ? PRINT_HTML_MAX_BYTES + IPC_MAX_BYTES : IPC_MAX_BYTES;
  if (sizeInBytes(channel, payload, byteLimit) > byteLimit) throw new IpcValidationError("oversize", "IPC payload exceeds the byte limit");
  let parsed: { success: boolean; data?: unknown };
  try {
    parsed = requestSchemas[channel].safeParse(payload);
  } catch {
    // Keep malformed or unexpectedly hostile values on the typed IPC error
    // surface even if a dependency changes its parser implementation.
    throw new IpcValidationError("schema", "IPC payload does not match the channel schema");
  }
  if (!parsed.success) throw new IpcValidationError("schema", "IPC payload does not match the channel schema");
  if ((parsed.data as { sessionGeneration: string }).sessionGeneration !== sender.sessionGeneration) throw new IpcValidationError("session", "IPC session generation is stale");
  if (channel === "desktop:open-external" && !isAllowedExternalUrl((parsed.data as unknown as { url: string }).url, sender.allowedExternalHosts ?? [])) {
    throw new IpcValidationError("external_url", "External URL is not approved by the HTTPS host allowlist");
  }
  if (channel === "desktop:engine-call" && containsPathLikeValue((parsed.data as unknown as { args: unknown }).args)) throw new IpcValidationError("schema", "IPC payload contains a filesystem path");
  return parsed.data as DesktopIpcRequest<C>;
}
export type IpcHandler<C extends DesktopIpcChannel> = (request: DesktopIpcRequest<C>) => Promise<unknown> | unknown;
export function createIpcDispatcher(handlers: Partial<{ [C in DesktopIpcChannel]: IpcHandler<C> }>, context: IpcSenderContext) {
  return async (channel: string, payload: unknown): Promise<unknown> => {
    const request = validateIpcRequest(channel, payload, context);
    const handler = handlers[channel as DesktopIpcChannel];
    if (!handler) throw new IpcValidationError("unknown_channel", "IPC channel has no host implementation");
    const result = await handler(request as never);
    const schema = responseSchemas[channel as DesktopIpcChannel];
    if (!schema) return result;
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new IpcValidationError("schema", "IPC response does not match the channel schema");
    return parsed.data;
  };
}

function containsPathLikeValue(value: unknown): boolean {
  // Binary file bytes hold no keys; never walk them (a per-byte walk of a
  // large PDF blocks the main process).
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  if (Array.isArray(value)) return value.some(containsPathLikeValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => /(?:^|_)(?:path|filepath|file_path)$/i.test(key) || containsPathLikeValue(child));
}
