import { MeetingSettingsSchema, type MeetingSettings } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** The organization's meeting settings (UNI-2026): owner/admin only; an
 *  untouched organization answers the defaults (auto summary on). */
export async function getMeetingSettings(orgId: string, signal?: AbortSignal): Promise<MeetingSettings | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/meetings/settings`, { signal });
  return parseWithFallback<MeetingSettings | null>(raw, MeetingSettingsSchema, null, {
    endpoint: "GET /api/v1/orgs/{orgID}/meetings/settings",
  });
}

/** Switches the summary the system makes when a meeting ends. */
export async function setMeetingAutoSummary(orgId: string, enabled: boolean): Promise<MeetingSettings | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/meetings/settings`, {
    method: "PUT",
    body: { auto_summary_enabled: enabled },
  });
  return parseWithFallback<MeetingSettings | null>(raw, MeetingSettingsSchema, null, {
    endpoint: "PUT /api/v1/orgs/{orgID}/meetings/settings",
  });
}

/** How long the organization keeps transcripts and uploaded audio (UNI-1995 #5): null keeps them. */
export async function setMeetingTranscriptRetention(orgId: string, days: number | null): Promise<MeetingSettings | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/meetings/transcript-retention`, {
    method: "PUT",
    body: { transcript_retention_days: days },
  });
  return parseWithFallback<MeetingSettings | null>(raw, MeetingSettingsSchema, null, {
    endpoint: "PUT /api/v1/orgs/{orgID}/meetings/transcript-retention",
  });
}
