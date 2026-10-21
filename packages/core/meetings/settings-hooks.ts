"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMeetingSettings, setMeetingAutoSummary } from "../api/endpoints/meeting-settings";

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
