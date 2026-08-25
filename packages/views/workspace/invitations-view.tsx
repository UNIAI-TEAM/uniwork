"use client";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import type { Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "@uniwork/ui/components/ui/sonner";

/** Danh sách lời mời đang chờ của user; chấp nhận từng cái hoặc tất cả. */
export function InvitationsView({ onJoined, onEmpty }: { onJoined: (ws: Workspace) => void; onEmpty: () => void }) {
  const { t } = useTranslation();
  const { data: invites, isFetched } = useMyInvitations();
  const accept = useAcceptInvite();
  useEffect(() => {
    if (isFetched && invites && invites.length === 0) onEmpty();
  }, [isFetched, invites, onEmpty]);
  if (!invites?.length) return null;

  const join = (token: string) =>
    accept.mutate(token, { onSuccess: (d) => onJoined(d.workspace), onError: () => toast.error(t("common.error")) });
  const joinAll = async () => {
    let last: Workspace | null = null;
    for (const i of invites) {
      try {
        last = (await accept.mutateAsync(i.token)).workspace;
      } catch {
        toast.error(t("common.error"));
      }
    }
    if (last) onJoined(last);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title-lg font-semibold text-primary">{t("invitations.title")}</h1>
        <p className="text-body text-text-secondary">{t("invitations.subtitle")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-caption text-text-secondary">{t("invitations.invitedBy", { name: i.invited_by.display_name })}</div>
              <div className="truncate text-body font-medium text-primary">
                {i.organization.name} › {i.workspace.name}
              </div>
              <div className="truncate font-mono text-caption text-text-secondary">
                {appHost()}/{i.organization.slug}/{i.workspace.slug} · {t("invitations.role", { role: i.role })}
              </div>
            </div>
            <Button variant="outline" disabled={accept.isPending} onClick={() => join(i.token)}>
              {t("invitations.join")}
            </Button>
          </li>
        ))}
      </ul>
      {invites.length > 1 && (
        <Button size="lg" className="w-full" disabled={accept.isPending} onClick={joinAll}>
          {t("invitations.joinAll")}
        </Button>
      )}
    </div>
  );
}
