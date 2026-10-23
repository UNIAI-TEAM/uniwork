"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMeetingSettings,
  setMeetingAutoSummary,
  setMeetingScribePolicy,
  setMeetingTranscriptRetention,
} from "../api/endpoints/meeting-settings";
import type { ScribePolicy } from "../types/meeting";

/** Organization-scoped, beside the meeting keys (UNI-2026). */
const meetingSettingsKey = (orgId: string) => ["meeting-settings", orgId] as const;

/** The organization meeting settings, readable by the owners/admins who may change them. */
export function useMeetingSettings(orgId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: meetingSettingsKey(orgId),
    queryFn: ({ signal }) => getMeetingSettings(orgId, signal),
    enabled: (opts?.enabled ?? true) && !!orgId,
  });
}

/** Switches auto summaries; the answer replaces the cached settings. An answer
 *  that does not parse is a failure, not a silent "saved". */
export function useSetMeetingAutoSummary(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const settings = await setMeetingAutoSummary(orgId, enabled);
      if (!settings) throw new Error("meeting_settings_invalid");
      return settings;
    },
    onSuccess: (settings) => qc.setQueryData(meetingSettingsKey(orgId), settings),
  });
}

/** Sets the AI scribe policy; the answer replaces the cached settings. */
export function useSetMeetingScribePolicy(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: ScribePolicy) => {
      const settings = await setMeetingScribePolicy(orgId, policy);
      if (!settings) throw new Error("meeting_settings_invalid");
      return settings;
    },
    onSuccess: (settings) => {
      qc.setQueryData(meetingSettingsKey(orgId), settings);
      // The meeting screens read the policy from their workspace's capabilities.
      void qc.invalidateQueries({ queryKey: ["meeting-capabilities"] });
    },
  });
}

/** How long the organization keeps transcripts and uploaded audio (UNI-1995 #5); null keeps them. */
export function useSetMeetingTranscriptRetention(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number | null) => {
      const settings = await setMeetingTranscriptRetention(orgId, days);
      if (!settings) throw new Error("meeting_settings_invalid");
      return settings;
    },
    onSuccess: (settings) => qc.setQueryData(meetingSettingsKey(orgId), settings),
  });
}
