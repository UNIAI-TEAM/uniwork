"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as meetings from "@uniwork/core/api/endpoints/meetings";
import type { UpdateMeetingBody } from "@uniwork/core/api/endpoints/meetings";
import { calendarKeys } from "@uniwork/core/calendar";
import { meetingKeys } from "@uniwork/core/meetings";
import { useUpdateTask } from "@uniwork/core/tasks";
import { useTranslation } from "react-i18next";
import { toastApiError } from "../toast-api-error";
import type { CalendarDropPatch } from "./calendar-drop-patch";

export function useCalendarMutations(wsId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const updateTask = useUpdateTask(wsId);

  const updateMeeting = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMeetingBody }) =>
      meetings.updateMeeting(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: calendarKeys.all(wsId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.list(wsId) });
    },
  });

  const invalidateCalendar = () => {
    void qc.invalidateQueries({ queryKey: calendarKeys.all(wsId) });
  };

  const applyDropPatch = async (patch: CalendarDropPatch) => {
    if (patch.kind === "task") {
      try {
        await updateTask.mutateAsync({ taskId: patch.entityId, patch: patch.patch });
        invalidateCalendar();
      } catch (err) {
        toastApiError(err, t("common.error"));
        throw err;
      }
      return;
    }

    try {
      const updated = await updateMeeting.mutateAsync({ id: patch.entityId, body: patch.body });
      if (!updated) {
        throw new Error("meeting_update_response_invalid");
      }
    } catch (err) {
      toastApiError(err, t("common.error"));
      throw err;
    }
  };

  return { applyDropPatch };
}
