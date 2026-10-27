"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";

/** Resolves the user id the trash API returns to a display name; a leaver stays a neutral label. */
export function useTrashedByName(workspaceId: string): (userId?: string) => string {
  const { t } = useTranslation();
  const members = useMembers(workspaceId);
  const names = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m.display_name])),
    [members.data],
  );
  return (userId) => (userId ? names.get(userId) : undefined) ?? t("trash.unknown_member");
}
