import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Translated captions (meeting scribe S6, UNI-2028).

/** The caption languages a viewer may pick; "" is the original captions. */
export type CaptionLanguage = "" | "vi" | "en";

/**
 * Sets the caller's caption language; the server writes it on their LiveKit
 * participant (a participant never writes its own attributes). True once the
 * server confirmed, false for an answer it cannot read.
 */
export async function setCaptionLanguage(meetingId: string, lang: CaptionLanguage): Promise<boolean> {
  const raw = await request(`/api/v1/meetings/${encodeURIComponent(meetingId)}/caption-language`, {
    method: "PUT",
    body: { lang },
  });
  const parsed = parseWithFallback<{ status: string } | null>(raw, z.object({ status: z.string() }), null, {
    endpoint: "PUT /api/v1/meetings/{id}/caption-language",
  });
  return parsed !== null;
}
