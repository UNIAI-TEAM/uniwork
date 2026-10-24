import { z } from "zod";
import { AiProposalSchema, type AiProposal } from "../../types/ai";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

const ProposalListSchema = z.object({ proposals: z.array(AiProposalSchema).catch([]) });
const ModeSchema = z.object({ mode: z.string() });
const CeilingSchema = z.object({ ceiling: z.string() });

// A row the answer could not be read as: no id, so no card is ever matched to it.
const UNREADABLE_ROW: AiProposal = AiProposalSchema.parse({});

/** Every call here answers the row as it stands after the call, so a card repaints from the answer. */
async function rowCall(endpoint: string, path: string, method: "POST" | "PATCH", body?: unknown): Promise<AiProposal> {
  const raw = await request(path, { method, body });
  return parseWithFallback<AiProposal>(raw, AiProposalSchema, UNREADABLE_ROW, { endpoint });
}

export const applyAiProposal = (id: string) =>
  rowCall("POST /api/v1/ai/proposals/{id}/apply", `/api/v1/ai/proposals/${id}/apply`, "POST");

export const rejectAiProposal = (id: string) =>
  rowCall("POST /api/v1/ai/proposals/{id}/reject", `/api/v1/ai/proposals/${id}/reject`, "POST");

export const undoAiProposal = (id: string) =>
  rowCall("POST /api/v1/ai/proposals/{id}/undo", `/api/v1/ai/proposals/${id}/undo`, "POST");

/** `changes` is {field: value}; the server merges it into the row's arguments and checks it again. */
export const editAiProposal = (id: string, changes: Record<string, unknown>) =>
  rowCall("PATCH /api/v1/ai/proposals/{id}", `/api/v1/ai/proposals/${id}`, "PATCH", { changes });

export const saveAiAnswerAsDocument = (conversationId: string, messageId: string) =>
  rowCall(
    "POST /api/v1/ai/conversations/{id}/messages/{id}/document",
    `/api/v1/ai/conversations/${conversationId}/messages/${messageId}/document`,
    "POST",
  );

/** Every row of the answer, in position order, as they stand after the call. */
export async function applyAiMessageProposals(conversationId: string, messageId: string, ids: string[]): Promise<AiProposal[]> {
  const raw = await request(`/api/v1/ai/conversations/${conversationId}/messages/${messageId}/proposals/apply`, {
    method: "POST",
    body: { proposal_ids: ids },
  });
  return parseWithFallback<{ proposals: AiProposal[] }>(raw, ProposalListSchema, { proposals: [] }, {
    endpoint: "POST /api/v1/ai/conversations/{id}/messages/{id}/proposals/apply",
  }).proposals;
}

/**
 * The rows a failed call carries: a refused apply is a 409 whose
 * `error.fields.proposal` is the failed row, a stopped apply-all one whose
 * `error.fields.proposals` is every row of the answer. Any other error has none.
 */
export function proposalRowsOfError(err: unknown): AiProposal[] {
  if (!(err instanceof ApiError) || !err.fields) return [];
  const endpoint = "ApiError.fields.proposal(s)";
  if (err.fields.proposals !== undefined) {
    return parseWithFallback<{ proposals: AiProposal[] }>({ proposals: err.fields.proposals }, ProposalListSchema, { proposals: [] }, { endpoint }).proposals;
  }
  if (err.fields.proposal === undefined) return [];
  const one = parseWithFallback<AiProposal | null>(err.fields.proposal, AiProposalSchema, null, { endpoint });
  return one ? [one] : [];
}

/** The mode the server saved (it may differ from the one sent only by being refused, which throws); a malformed answer reads as the one sent. */
export async function setAskUniMode(mode: string): Promise<string> {
  const raw = await request("/api/v1/me/ask-uni-mode", { method: "PUT", body: { mode } });
  return parseWithFallback<{ mode: string }>(raw, ModeSchema, { mode }, { endpoint: "PUT /api/v1/me/ask-uni-mode" }).mode;
}

/** The organization's write ceiling; unset on the server is "plan", and so is a malformed answer. */
export async function getAskWritePolicy(orgId: string): Promise<string> {
  const raw = await request(`/api/v1/orgs/${orgId}/ai/ask-write-policy`);
  return parseWithFallback<{ ceiling: string }>(raw, CeilingSchema, { ceiling: "plan" }, {
    endpoint: "GET /api/v1/orgs/{id}/ai/ask-write-policy",
  }).ceiling;
}

export async function setAskWritePolicy(orgId: string, ceiling: string): Promise<string> {
  const raw = await request(`/api/v1/orgs/${orgId}/ai/ask-write-policy`, { method: "PUT", body: { ceiling } });
  return parseWithFallback<{ ceiling: string }>(raw, CeilingSchema, { ceiling }, {
    endpoint: "PUT /api/v1/orgs/{id}/ai/ask-write-policy",
  }).ceiling;
}
