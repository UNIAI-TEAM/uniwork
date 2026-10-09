import { z } from "zod";

/**
 * Mirrors the GO-A7 SDO (docs/office/g3g4/uniwork-office-app-api-contract.md §3).
 * Lenient on the wire: server enums stay strings, every optional field defaults.
 */

export const AiOfficeProviderSchema = z.object({
  id: z.string(),
  protocol: z.string().optional().default(""),
  requires_base_url: z.boolean().optional().default(false),
  default_base_url: z.string().optional().default(""),
});
export type AiOfficeProvider = z.infer<typeof AiOfficeProviderSchema>;

/** Never carries the key: `key_hint` is "…" plus its last four characters. */
export const AiCredentialSchema = z.object({
  provider: z.string(),
  label: z.string().optional().default(""),
  base_url: z.string().optional().default(""),
  key_hint: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
});
export type AiCredential = z.infer<typeof AiCredentialSchema>;

export const AiCredentialListSchema = z.object({
  items: z.array(AiCredentialSchema).optional().default([]),
  providers: z.array(AiOfficeProviderSchema).optional().default([]),
});
export type AiCredentialList = z.infer<typeof AiCredentialListSchema>;

export interface SaveAiCredentialInput {
  /** Required on create (<= 4096 chars); omit on update to keep the stored key. */
  api_key?: string;
  base_url?: string;
  /** <= 80 chars. */
  label?: string;
}

export const AiCloudToolsSchema = z.object({
  web_search: z.boolean().optional().default(false),
  image_search: z.boolean().optional().default(false),
  image_generate: z.boolean().optional().default(false),
  media_analyze: z.boolean().optional().default(false),
  transcribe: z.boolean().optional().default(false),
});
export type AiCloudTools = z.infer<typeof AiCloudToolsSchema>;

export const AiCloudCreditsSchema = z.object({
  unit: z.string().optional().default("ai.tokens"),
  used: z.number().optional().default(0),
  limit: z.number().nullable().optional().default(null),
  remaining: z.number().nullable().optional().default(null),
  period_end: z.string().nullable().optional().default(null),
});
export type AiCloudCredits = z.infer<typeof AiCloudCreditsSchema>;

export const AiCloudStatusSchema = z.object({
  enabled: z.boolean(),
  /** `entitlement_required` when the plan lacks `office.ai_cloud`. */
  reason: z.string().optional().default(""),
  tools: AiCloudToolsSchema.optional().default({
    web_search: false,
    image_search: false,
    image_generate: false,
    media_analyze: false,
    transcribe: false,
  }),
  credits: AiCloudCreditsSchema.optional().default({
    unit: "ai.tokens",
    used: 0,
    limit: null,
    remaining: null,
    period_end: null,
  }),
});
export type AiCloudStatus = z.infer<typeof AiCloudStatusSchema>;

export type AiCloudSearchKind = "web" | "image";

export interface AiCloudSearchInput {
  /** <= 400 chars. */
  query: string;
  kind: AiCloudSearchKind;
  /** 1..10, server default 6. */
  max_results?: number;
}

export const AiCloudSearchResultSchema = z.object({
  title: z.string().optional().default(""),
  url: z.string().optional().default(""),
  snippet: z.string().optional().default(""),
  image_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
});
export type AiCloudSearchResult = z.infer<typeof AiCloudSearchResultSchema>;

export const AiCloudSearchResponseSchema = z.object({
  results: z.array(AiCloudSearchResultSchema).optional().default([]),
  answer: z.string().optional(),
});
export type AiCloudSearchResponse = z.infer<typeof AiCloudSearchResponseSchema>;

/** Bytes travel in the body: the server never fetches a media URL. */
export interface AiCloudMedia {
  mime: string;
  data_base64: string;
}

export interface AiCloudImageInput {
  /** <= 4000 chars. */
  prompt: string;
  aspect_ratio?: string;
  image_size?: string;
  /** <= 4 images, each <= 8 MiB. */
  reference_images?: AiCloudMedia[];
}

export const AiCloudMediaSchema = z.object({
  mime: z.string().optional().default(""),
  data_base64: z.string().optional().default(""),
});

export const AiCloudImageResponseSchema = z.object({
  images: z.array(AiCloudMediaSchema).optional().default([]),
  model: z.string().optional().default(""),
});
export type AiCloudImageResponse = z.infer<typeof AiCloudImageResponseSchema>;

export interface AiCloudAnalyzeInput {
  /** <= 4000 chars. */
  requirements: string;
  /** <= 4 items, total <= 25 MiB. */
  media: AiCloudMedia[];
}

export interface AiCloudTranscribeInput {
  prompt?: string;
  /** <= 25 MiB. */
  audio: AiCloudMedia;
}

export const AiCloudTextResponseSchema = z.object({ text: z.string().optional().default("") });
export type AiCloudTextResponse = z.infer<typeof AiCloudTextResponseSchema>;
