import {
  AiCloudImageResponseSchema,
  AiCloudSearchResponseSchema,
  AiCloudStatusSchema,
  AiCloudTextResponseSchema,
  type AiCloudAnalyzeInput,
  type AiCloudImageInput,
  type AiCloudImageResponse,
  type AiCloudSearchInput,
  type AiCloudSearchResponse,
  type AiCloudStatus,
  type AiCloudTextResponse,
  type AiCloudTranscribeInput,
} from "../../types/ai-office";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/** Org-scoped UniWork AI routes of the Office app (GO-A7, contract §3). */

const DISABLED_CLOUD: AiCloudStatus = {
  enabled: false,
  reason: "",
  tools: { web_search: false, image_search: false, image_generate: false, media_analyze: false, transcribe: false, chat: false },
  credits: { unit: "ai.tokens", used: 0, limit: null, remaining: null, period_end: null },
  uniwork_model: "",
};
const EMPTY_SEARCH: AiCloudSearchResponse = { results: [] };
const EMPTY_IMAGES: AiCloudImageResponse = { images: [], model: "" };
const EMPTY_TEXT: AiCloudTextResponse = { text: "" };

const orgAi = (orgId: string) => `/api/v1/orgs/${orgId}/ai`;

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
