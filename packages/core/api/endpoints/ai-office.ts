import {
  AiCloudImageResponseSchema,
  AiCloudSearchResponseSchema,
  AiCloudStatusSchema,
  AiCloudTextResponseSchema,
  AiCredentialListSchema,
  AiCredentialSchema,
  type AiCloudAnalyzeInput,
  type AiCloudImageInput,
  type AiCloudImageResponse,
  type AiCloudSearchInput,
  type AiCloudSearchResponse,
  type AiCloudStatus,
  type AiCloudTextResponse,
  type AiCloudTranscribeInput,
  type AiCredential,
  type AiCredentialList,
  type SaveAiCredentialInput,
} from "../../types/ai-office";
import { runtimeConfig } from "../../runtime-config";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * Org-scoped AI routes of the Office app (GO-A7, contract §3). The BYOK proxy
 * is not an endpoint here: the frame's ai-provider speaks the vendor's own wire
 * format straight to `byokProxyBaseUrl`.
 */

const EMPTY_CREDENTIALS: AiCredentialList = { items: [], providers: [] };
const DISABLED_CLOUD: AiCloudStatus = {
  enabled: false,
  reason: "",
  tools: { web_search: false, image_search: false, image_generate: false, media_analyze: false, transcribe: false },
  credits: { unit: "ai.tokens", used: 0, limit: null, remaining: null, period_end: null },
};
const EMPTY_SEARCH: AiCloudSearchResponse = { results: [] };
const EMPTY_IMAGES: AiCloudImageResponse = { images: [], model: "" };
const EMPTY_TEXT: AiCloudTextResponse = { text: "" };

const orgAi = (orgId: string) => `/api/v1/orgs/${orgId}/ai`;

/**
 * Where the frame points a vendor SDK instead of the vendor host. Pure string
 * work: the proxy path under it (`/chat/completions`, `/messages`, `/generate`,
 * `/models`) is the one the vendor protocol would have used.
 */
export function byokProxyBaseUrl(orgId: string, provider: string): string {
  return `${runtimeConfig().apiUrl}${orgAi(orgId)}/byok/${encodeURIComponent(provider)}`;
}

export async function listAiCredentials(orgId: string): Promise<AiCredentialList> {
  const raw = await request(`${orgAi(orgId)}/credentials`);
  return parseWithFallback<AiCredentialList>(raw, AiCredentialListSchema, EMPTY_CREDENTIALS, {
    endpoint: "GET /api/v1/orgs/{id}/ai/credentials",
  });
}

/**
 * A malformed answer to a save throws: the write succeeded or failed on the
 * server, and an invented "credential" would show a key as stored that is not.
 */
export async function saveAiCredential(
  orgId: string,
  provider: string,
  body: SaveAiCredentialInput,
): Promise<AiCredential> {
  const raw = await request(`${orgAi(orgId)}/credentials/${encodeURIComponent(provider)}`, { method: "PUT", body });
  const parsed = AiCredentialSchema.safeParse(raw);
  if (!parsed.success) throw new Error("ai_credential_invalid");
  return parsed.data;
}

export async function deleteAiCredential(orgId: string, provider: string): Promise<void> {
  await request(`${orgAi(orgId)}/credentials/${encodeURIComponent(provider)}`, { method: "DELETE" });
}

/** Never 403 on the wire: a plan without the feature answers `enabled:false`. */
export async function getAiCloudStatus(orgId: string): Promise<AiCloudStatus> {
  const raw = await request(`${orgAi(orgId)}/cloud`);
  return parseWithFallback<AiCloudStatus>(raw, AiCloudStatusSchema, DISABLED_CLOUD, {
    endpoint: "GET /api/v1/orgs/{id}/ai/cloud",
  });
}

export async function aiCloudSearch(orgId: string, body: AiCloudSearchInput): Promise<AiCloudSearchResponse> {
  const raw = await request(`${orgAi(orgId)}/cloud/search`, { method: "POST", body });
  return parseWithFallback<AiCloudSearchResponse>(raw, AiCloudSearchResponseSchema, EMPTY_SEARCH, {
    endpoint: "POST /api/v1/orgs/{id}/ai/cloud/search",
  });
}

export async function aiCloudGenerateImage(orgId: string, body: AiCloudImageInput): Promise<AiCloudImageResponse> {
  const raw = await request(`${orgAi(orgId)}/cloud/images`, { method: "POST", body });
  return parseWithFallback<AiCloudImageResponse>(raw, AiCloudImageResponseSchema, EMPTY_IMAGES, {
    endpoint: "POST /api/v1/orgs/{id}/ai/cloud/images",
  });
}

export async function aiCloudAnalyzeMedia(orgId: string, body: AiCloudAnalyzeInput): Promise<AiCloudTextResponse> {
  const raw = await request(`${orgAi(orgId)}/cloud/media/analyze`, { method: "POST", body });
  return parseWithFallback<AiCloudTextResponse>(raw, AiCloudTextResponseSchema, EMPTY_TEXT, {
    endpoint: "POST /api/v1/orgs/{id}/ai/cloud/media/analyze",
  });
}

export async function aiCloudTranscribe(orgId: string, body: AiCloudTranscribeInput): Promise<AiCloudTextResponse> {
  const raw = await request(`${orgAi(orgId)}/cloud/transcribe`, { method: "POST", body });
  return parseWithFallback<AiCloudTextResponse>(raw, AiCloudTextResponseSchema, EMPTY_TEXT, {
    endpoint: "POST /api/v1/orgs/{id}/ai/cloud/transcribe",
  });
}
