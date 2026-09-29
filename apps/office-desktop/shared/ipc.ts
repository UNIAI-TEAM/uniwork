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
] as const;
export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[number];
/** Main-to-renderer events are a separate, equally narrow allowlist. Event
 * payloads are parsed in main before send and again in preload. */
export const DESKTOP_EVENTS = ["desktop:launch-requested"] as const;
const sessionGenerationSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "invalid session generation");
const opaqueHandleSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/, "invalid opaque handle");
const operationSchema = z.enum(["capability", "open", "edit", "serialize", "cancel"]);
const originSchema = z.string().url().max(2048);
const deploymentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid deployment");
const clientIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid client id");
const attemptIdSchema = z.string().regex(/^attempt_[A-Za-z0-9_-]{32,160}$/, "invalid attempt id");
const documentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "invalid document id");
export const launchRequestedEventSchema = z.object({ documentId: documentIdSchema, operation: z.enum(["view", "edit"]) }).strict();
export type LaunchRequestedEvent = z.infer<typeof launchRequestedEventSchema>;
export const desktopSessionMetadataSchema = z.object({
  status: z.enum(["signed-out", "pending", "signed-in"]),
  accountId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
  deploymentId: deploymentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "signed-in" && (!value.accountId || !value.deploymentId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "signed-in metadata requires account and deployment" });
  if (value.status !== "signed-in" && (value.accountId !== undefined || value.deploymentId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "signed-out/pending metadata cannot include account" });
});
export type DesktopSessionMetadata = z.infer<typeof desktopSessionMetadataSchema>;
const requestSchemas = {
  "desktop:bootstrap": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
  "desktop:engine-call": z.object({ sessionGeneration: sessionGenerationSchema, operation: operationSchema, handle: opaqueHandleSchema, args: z.record(z.string(), z.unknown()).default({}) }).strict(),
  "desktop:open-external": z.object({ sessionGeneration: sessionGenerationSchema, url: z.string().url().max(2048) }).strict(),
  "desktop:auth-start": z.object({ sessionGeneration: sessionGenerationSchema, clientId: clientIdSchema, deploymentId: deploymentSchema }).strict(),
  "desktop:auth-cancel": z.object({ sessionGeneration: sessionGenerationSchema, attemptId: attemptIdSchema }).strict(),
  "desktop:auth-session": z.object({ sessionGeneration: sessionGenerationSchema }).strict(),
} as const;
export type DesktopIpcRequest<C extends DesktopIpcChannel = DesktopIpcChannel> = z.infer<(typeof requestSchemas)[C]>;
export type IpcSenderContext = { senderId: number; frameId: number; origin: string; expectedSenderId: number; expectedFrameId: number; expectedOrigin: string; sessionGeneration: string; allowedExternalHosts?: readonly string[] };
export type IpcValidationErrorCode = "unknown_channel" | "oversize" | "sender" | "frame" | "origin" | "session" | "schema" | "external_url";
export class IpcValidationError extends Error { readonly code: IpcValidationErrorCode; constructor(code: IpcValidationErrorCode, message: string) { super(message); this.name = "IpcValidationError"; this.code = code; } }
export const IPC_MAX_BYTES = 64 * 1024;

/** Measure the JSON wire representation without accepting values that
 * Electron's structured-clone transport can carry outside JSON. A bounded,
 * recursive walk rejects ArrayBuffer/Blob/Map/Set, class instances, cycles,
 * non-finite numbers and deeply nested values before schema parsing. */
function sizeInBytes(value: unknown): number {
  const encoder = new TextEncoder();
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): number => {
    if (depth > 256) return IPC_MAX_BYTES + 1;
    if (current === null) return 4;
    switch (typeof current) {
      case "boolean": return current ? 4 : 5;
      case "string": return encoder.encode(JSON.stringify(current)).byteLength;
      case "number": return Number.isFinite(current) ? encoder.encode(String(current)).byteLength : IPC_MAX_BYTES + 1;
      case "object": break;
      default: return IPC_MAX_BYTES + 1;
    }
    if (seen.has(current)) return IPC_MAX_BYTES + 1;
    seen.add(current);
    let total = Array.isArray(current) ? 2 : 2;
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        total += (index === 0 ? 0 : 1) + visit(current[index], depth + 1);
        if (total > IPC_MAX_BYTES) return total;
      }
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return IPC_MAX_BYTES + 1;
      for (const [key, child] of Object.entries(current)) {
        total += encoder.encode(JSON.stringify(key)).byteLength + 1 + visit(child, depth + 1);
        if (total > IPC_MAX_BYTES) return total;
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
  if (sizeInBytes(payload) > IPC_MAX_BYTES) throw new IpcValidationError("oversize", "IPC payload exceeds the byte limit");
  const parsed = requestSchemas[channel].safeParse(payload);
  if (!parsed.success) throw new IpcValidationError("schema", "IPC payload does not match the channel schema");
  if ((parsed.data as { sessionGeneration: string }).sessionGeneration !== sender.sessionGeneration) throw new IpcValidationError("session", "IPC session generation is stale");
  if (channel === "desktop:open-external" && !isAllowedExternalUrl((parsed.data as unknown as { url: string }).url, sender.allowedExternalHosts ?? [])) {
    throw new IpcValidationError("external_url", "External URL is not approved by the HTTPS host allowlist");
  }
  return parsed.data as DesktopIpcRequest<C>;
}
export type IpcHandler<C extends DesktopIpcChannel> = (request: DesktopIpcRequest<C>) => Promise<unknown> | unknown;
export function createIpcDispatcher(handlers: Partial<{ [C in DesktopIpcChannel]: IpcHandler<C> }>, context: IpcSenderContext) {
  return async (channel: string, payload: unknown): Promise<unknown> => {
    const request = validateIpcRequest(channel, payload, context);
    const handler = handlers[channel as DesktopIpcChannel];
    if (!handler) throw new IpcValidationError("unknown_channel", "IPC channel has no host implementation");
    return handler(request as never);
  };
}
