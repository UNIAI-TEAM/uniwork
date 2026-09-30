import { z } from "zod";
import { isAllowedExternalUrl } from "./external-url";

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
  "desktop:diagnostics",
  "desktop:file-pick-open",
  "desktop:file-open",
  "desktop:file-save",
  "desktop:file-save-as",
  "desktop:draft-checkpoint",
  "desktop:draft-list",
  "desktop:draft-recover",
  "desktop:draft-discard",
] as const;
export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[number];
/** Main-to-renderer events are a separate, equally narrow allowlist. Event
 * payloads are parsed in main before send and again in preload. */
export const DESKTOP_EVENTS = ["desktop:launch-requested", "desktop:auth-session-changed"] as const;
const sessionGenerationSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "invalid session generation");
const opaqueHandleSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/, "invalid opaque handle");
const operationSchema = z.enum(["capability", "open", "edit", "serialize", "cancel"]);
const originSchema = z.string().url().max(2048);
const deploymentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid deployment");
const clientIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid client id");
const attemptIdSchema = z.string().regex(/^attempt_[A-Za-z0-9_-]{32,160}$/, "invalid attempt id");
const fileHandleSchema = z.string().regex(/^file_[A-Za-z0-9_-]{32,160}$/, "invalid file handle");
const draftIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/, "invalid draft id");
const IPC_FILE_MAX_BYTES = 192 * 1024 * 1024;
/**
 * Validate the base64 wire value with a bounded linear scan.  A large
 * Office document can contain hundreds of millions of base64 characters;
 * the usual grouped RegExp backtracks deeply enough to overflow the V8
 * stack long before the transport bound is reached.
 */
function isBase64Bytes(value: string): boolean {
  if (value.length > IPC_FILE_MAX_BYTES || (value.length & 3) !== 0) return false;
  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 61) {
      padding += 1;
      if (padding > 2 || index < value.length - 2) return false;
      continue;
    }
    const alphaNumeric = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (padding > 0 || (!alphaNumeric && code !== 43 && code !== 47)) {
      return false;
    }
  }
  return true;
}
const base64BytesSchema = z.string().max(IPC_FILE_MAX_BYTES).refine(isBase64Bytes, "invalid byte encoding");
export const desktopFileMetadataSchema = z.object({
  handle: fileHandleSchema,
  name: z.string().min(1).max(255),
  byteLength: z.number().int().nonnegative(),
  modifiedAtMs: z.number().finite().nonnegative(),
  checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();
export const desktopFileResponseSchema = z.object({ opened: z.boolean(), metadata: desktopFileMetadataSchema.optional() }).strict();
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
export const desktopDraftMetadataSchema = draftMetadataSchema;
export const desktopDraftListResponseSchema = z.object({ drafts: z.array(draftMetadataSchema) }).strict();
export const desktopDraftRecoveryResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recovered"), metadata: draftMetadataSchema, dataBase64: base64BytesSchema }).strict(),
  z.object({ status: z.literal("missing") }).strict(),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(draftMetadataSchema) }).strict(),
  z.object({ status: z.literal("conflict"), metadata: draftMetadataSchema, currentBase: draftBaseSchema, draftBase: draftBaseSchema }).strict(),
  z.object({ status: z.literal("blocked"), metadata: draftMetadataSchema, reason: z.literal("edit_acl_missing") }).strict(),
  z.object({ status: z.literal("locked"), metadata: draftMetadataSchema.optional(), code: z.literal("draft_recovery_locked") }).strict(),
]);
export const desktopDraftDiscardResponseSchema = z.object({ discarded: z.boolean() }).strict();
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
export const desktopAuthConfigResponseSchema = z.object({ clientId: clientIdSchema, deploymentId: deploymentSchema }).strict();
const responseSchemas: Partial<Record<DesktopIpcChannel, z.ZodTypeAny>> = {
  "desktop:file-pick-open": desktopFileResponseSchema,
  "desktop:file-open": desktopFileResponseSchema,
  "desktop:file-save": desktopFileResponseSchema,
  "desktop:file-save-as": desktopFileResponseSchema,
  "desktop:draft-checkpoint": desktopDraftResponseSchema,
  "desktop:draft-list": desktopDraftListResponseSchema,
  "desktop:draft-recover": desktopDraftRecoveryResponseSchema,
  "desktop:draft-discard": desktopDraftDiscardResponseSchema,
  "desktop:diagnostics": desktopDiagnosticsResponseSchema,
};
const documentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid document id");
export const launchRequestedEventSchema = z.object({ documentId: documentIdSchema, operation: z.enum(["view", "edit"]) }).strict();
export type LaunchRequestedEvent = z.infer<typeof launchRequestedEventSchema>;
export const desktopSessionMetadataSchema = z.object({
  status: z.enum(["signed-out", "pending", "signed-in", "locked", "login-required"]),
  accountId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
  deploymentId: deploymentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "signed-in" && (!value.accountId || !value.deploymentId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "signed-in metadata requires account and deployment" });
  if (value.status !== "signed-in" && (value.accountId !== undefined || value.deploymentId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "non-signed-in metadata cannot include account" });
});
export type DesktopSessionMetadata = z.infer<typeof desktopSessionMetadataSchema>;
const requestSchemas = {
  "desktop:bootstrap": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:engine-call": z.object({ sessionGeneration: sessionGenerationSchema, operation: operationSchema, handle: opaqueHandleSchema, args: z.record(z.string(), z.unknown()).default({}) }).strict(),
  "desktop:open-external": z.object({ sessionGeneration: sessionGenerationSchema, url: z.string().url().max(2048) }).strict(),
  "desktop:auth-start": z.object({ sessionGeneration: sessionGenerationSchema, clientId: clientIdSchema, deploymentId: deploymentSchema }).strict(),
  "desktop:auth-cancel": z.object({ sessionGeneration: sessionGenerationSchema, attemptId: attemptIdSchema }).strict(),
  "desktop:auth-session": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:auth-config": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:auth-logout": z.object({ sessionGeneration: sessionGenerationSchema, scope: z.enum(["device", "family"]).default("device") }).strict(),
  "desktop:diagnostics": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:file-pick-open": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:file-open": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema }).strict(),
  "desktop:file-save": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema, dataBase64: base64BytesSchema }).strict(),
  "desktop:file-save-as": z.object({ sessionGeneration: sessionGenerationSchema, handle: fileHandleSchema, dataBase64: base64BytesSchema }).strict(),
  "desktop:draft-checkpoint": z.object({ sessionGeneration: sessionGenerationSchema, draftId: draftIdSchema, generation: z.number().int().positive(), dataBase64: base64BytesSchema }).strict(),
  "desktop:draft-list": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:draft-recover": z.object({ sessionGeneration: sessionGenerationSchema, draftId: draftIdSchema, currentBase: draftBaseSchema }).strict(),
  "desktop:draft-discard": z.object({ sessionGeneration: sessionGenerationSchema, draftId: draftIdSchema, generation: z.number().int().positive() }).strict(),
} as const;
export type DesktopIpcRequest<C extends DesktopIpcChannel = DesktopIpcChannel> = z.infer<(typeof requestSchemas)[C]>;
export type IpcSenderContext = { senderId: number; frameId: number; origin: string; expectedSenderId: number; expectedFrameId: number; expectedOrigin: string; sessionGeneration: string; allowedExternalHosts?: readonly string[] };
export type IpcValidationErrorCode = "unknown_channel" | "oversize" | "sender" | "frame" | "origin" | "session" | "schema" | "external_url";
export class IpcValidationError extends Error { readonly code: IpcValidationErrorCode; constructor(code: IpcValidationErrorCode, message: string) { super(message); this.name = "IpcValidationError"; this.code = code; } }
export const IPC_MAX_BYTES = 64 * 1024;
/** File/draft byte payloads are bounded separately so ordinary control IPC
 * remains small while realistic Office documents can cross the typed seam. */
export { IPC_FILE_MAX_BYTES };

/** Measure the JSON wire representation without accepting values that
 * Electron's structured-clone transport can carry outside JSON. A bounded,
 * recursive walk rejects ArrayBuffer/Blob/Map/Set, class instances, cycles,
 * non-finite numbers and deeply nested values before schema parsing. */
function sizeInBytes(value: unknown, maxBytes = IPC_MAX_BYTES): number {
  const encoder = new TextEncoder();
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): number => {
    if (depth > 256) return maxBytes + 1;
    if (current === null) return 4;
    switch (typeof current) {
      case "boolean": return current ? 4 : 5;
      case "string": return encoder.encode(JSON.stringify(current)).byteLength;
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
        total += encoder.encode(JSON.stringify(key)).byteLength + 1 + visit(child, depth + 1);
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
  const byteLimit = channel.startsWith("desktop:file-") || channel === "desktop:draft-checkpoint" ? IPC_FILE_MAX_BYTES : IPC_MAX_BYTES;
  if (sizeInBytes(payload, byteLimit) > byteLimit) throw new IpcValidationError("oversize", "IPC payload exceeds the byte limit");
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
  if (Array.isArray(value)) return value.some(containsPathLikeValue);
  if (!value || typeof value !== "object") return typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/"));
  return Object.entries(value).some(([key, child]) => /(?:^|_)(?:path|filepath|file_path)$/i.test(key) || containsPathLikeValue(child));
}
