import { AiMemoryImportResultSchema, AiMemoryImportSplitSchema, AiMemoryListSchema, AiMemoryProposalSchema, AiMemorySchema } from "../../types/ai";
import type { AiMemory, AiMemoryImportResult, AiMemoryImportSplit, AiMemoryList, AiMemoryProposal } from "../../types/ai";
import { z } from "zod";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

const ClearSchema = z.object({ deleted: z.number() });

// An answer that could not be read: no id, so nothing is ever matched to it.
const UNREADABLE_ENTRY: AiMemory = AiMemorySchema.parse({});
const UNREADABLE_ROW: AiMemoryProposal = AiMemoryProposalSchema.parse({});
// shortcut: the fallback limit mirrors the server's 50-entry cap; the real one arrives with every readable list.
const EMPTY_LIST: AiMemoryList = AiMemoryListSchema.parse({});

// `{org}` is the organization slug, never its id: the server resolves it with orgIDFromSlug.
const base = (orgSlug: string) => `/api/v1/orgs/${orgSlug}/ai/memory`;

export async function listAiMemory(orgSlug: string): Promise<AiMemoryList> {
  const raw = await request(base(orgSlug));
  return parseWithFallback<AiMemoryList>(raw, AiMemoryListSchema, EMPTY_LIST, { endpoint: "GET /api/v1/orgs/{org}/ai/memory" });
}

async function entryCall(endpoint: string, path: string, method: "POST" | "PATCH", body: unknown): Promise<AiMemory> {
  const raw = await request(path, { method, body });
  return parseWithFallback<AiMemory>(raw, AiMemorySchema, UNREADABLE_ENTRY, { endpoint });
}

export const createAiMemory = (orgSlug: string, body: { kind: string; text: string }) =>
  entryCall("POST /api/v1/orgs/{org}/ai/memory", base(orgSlug), "POST", body);

export const updateAiMemory = (orgSlug: string, id: string, body: { kind?: string; text?: string }) =>
  entryCall("PATCH /api/v1/orgs/{org}/ai/memory/{id}", `${base(orgSlug)}/${id}`, "PATCH", body);

export async function deleteAiMemory(orgSlug: string, id: string): Promise<void> {
  await request(`${base(orgSlug)}/${id}`, { method: "DELETE" });
}

/** The number of entries the server deleted; a malformed answer reads as 0. */
export async function clearAiMemory(orgSlug: string): Promise<number> {
  const raw = await request(base(orgSlug), { method: "DELETE" });
  return parseWithFallback<{ deleted: number }>(raw, ClearSchema, { deleted: 0 }, { endpoint: "DELETE /api/v1/orgs/{org}/ai/memory" }).deleted;
}

export async function splitAiMemoryImport(orgSlug: string, text: string): Promise<AiMemoryImportSplit> {
  const raw = await request(`${base(orgSlug)}/import/split`, { method: "POST", body: { text } });
  return parseWithFallback<AiMemoryImportSplit>(raw, AiMemoryImportSplitSchema, { candidates: [], skipped: [] }, {
    endpoint: "POST /api/v1/orgs/{org}/ai/memory/import/split",
  });
}

export async function importAiMemory(orgSlug: string, entries: { kind: string; text: string }[]): Promise<AiMemoryImportResult> {
  const raw = await request(`${base(orgSlug)}/import`, { method: "POST", body: { entries } });
  return parseWithFallback<AiMemoryImportResult>(raw, AiMemoryImportResultSchema, { ...EMPTY_LIST, skipped_duplicates: 0 }, {
    endpoint: "POST /api/v1/orgs/{org}/ai/memory/import",
  });
}

/** The switch "Dùng bộ nhớ"; the server answers 204. */
export async function setAskUniMemory(enabled: boolean): Promise<void> {
  await request("/api/v1/me/ask-uni-memory", { method: "PUT", body: { enabled } });
}

/** Every call answers the row as it stands after the call, so a card repaints from the answer. */
async function rowCall(endpoint: string, path: string, method: "POST" | "PATCH", body?: unknown): Promise<AiMemoryProposal> {
  const raw = await request(path, { method, body });
  return parseWithFallback<AiMemoryProposal>(raw, AiMemoryProposalSchema, UNREADABLE_ROW, { endpoint });
}

const proposalPath = (id: string) => `/api/v1/ai/memory-proposals/${id}`;

export const applyAiMemoryProposal = (id: string) =>
  rowCall("POST /api/v1/ai/memory-proposals/{id}/apply", `${proposalPath(id)}/apply`, "POST");

export const rejectAiMemoryProposal = (id: string) =>
  rowCall("POST /api/v1/ai/memory-proposals/{id}/reject", `${proposalPath(id)}/reject`, "POST");

export const undoAiMemoryProposal = (id: string) =>
  rowCall("POST /api/v1/ai/memory-proposals/{id}/undo", `${proposalPath(id)}/undo`, "POST");

export const editAiMemoryProposal = (id: string, body: { kind?: string; text?: string }) =>
  rowCall("PATCH /api/v1/ai/memory-proposals/{id}", proposalPath(id), "PATCH", body);

/** The row a refused call carries in `error.fields.proposal` (a 409 on a row already decided); any other error has none. */
export function memoryProposalRowsOfError(err: unknown): AiMemoryProposal[] {
  if (!(err instanceof ApiError) || err.fields?.proposal === undefined) return [];
  const one = parseWithFallback<AiMemoryProposal | null>(err.fields.proposal, AiMemoryProposalSchema, null, {
    endpoint: "ApiError.fields.proposal(memory)",
  });
  return one && one.id !== "" ? [one] : [];
}
