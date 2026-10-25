import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** How to call into one meeting by phone (spec 2026-10-20-meeting-scribe-agent-design §5.4). */
export interface MeetingDialIn {
  enabled: boolean;
  number: string;
  pin: string;
}

const DialInSchema = z.object({
  enabled: z.boolean(),
  number: z.string().catch(""),
  pin: z.string().catch(""),
});

/** A drifted answer reads as "no dial-in", so the page never shows half a line. */
const DIAL_IN_OFF: MeetingDialIn = { enabled: false, number: "", pin: "" };

/** GET /meetings/{id}/dial-in: the deployment's number and the meeting's PIN (members). */
export async function getMeetingDialIn(meetingId: string): Promise<MeetingDialIn> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/dial-in`);
  return parseWithFallback(raw, DialInSchema, DIAL_IN_OFF, { endpoint: "GET /api/v1/meetings/{id}/dial-in" });
}

/** POST /meetings/{id}/dial-in/pin: host or admin draw a new PIN. */
export async function rotateMeetingDialInPin(meetingId: string): Promise<MeetingDialIn> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/dial-in/pin`, { method: "POST" });
  return parseWithFallback(raw, DialInSchema, DIAL_IN_OFF, { endpoint: "POST /api/v1/meetings/{id}/dial-in/pin" });
}
