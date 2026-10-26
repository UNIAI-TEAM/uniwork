"use client";
import { useMutation } from "@tanstack/react-query";
import { type CaptionLanguage, setCaptionLanguage } from "../api/endpoints/meeting-captions";

export type { CaptionLanguage } from "../api/endpoints/meeting-captions";

/** The viewer's caption language; nothing is cached, the room reads the attribute. */
export function useSetCaptionLanguage(meetingId: string) {
  return useMutation({ mutationFn: (lang: CaptionLanguage) => setCaptionLanguage(meetingId, lang) });
}
