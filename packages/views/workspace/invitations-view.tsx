"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import type { Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useMyInvitations } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";

/** Danh sách lời mời đang chờ của user; chấp nhận từng cái hoặc tất cả. */
export function InvitationsView({ onJoined, onEmpty }: { onJoined: (ws: Workspace) => void; onEmpty: () => void }) {
  const { t } = useTranslation();
  const { data: invites, isFetched } = useMyInvitations();
  const accept = useAcceptInvite();
  // Once a join succeeded the list empties by design; onEmpty must not
  // override the navigation onJoined already started.
  const joined = useRef(false);
  useEffect(() => {
    if (!joined.current && isFetched && invites && invites.length === 0) onEmpty();
  }, [isFetched, invites, onEmpty]);
  if (!invites?.length) return null;

  const join = (token: string) =>
    accept.mutate(token, {
      onSuccess: (workspace) => {
        joined.current = true;
        if (workspace) onJoined(workspace);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  const joinAll = async () => {
    let last: Workspace | null = null;
    for (const i of invites) {
      try {
        last = (await accept.mutateAsync(i.token)) ?? last;
      } catch (err) {
        toastApiError(err, t("common.error"));
      }
    }
    if (last) {
      joined.current = true;
      onJoined(last);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title-lg font-semibold text-foreground">{t("invitations.title")}</h1>
        <p className="text-body text-muted-foreground">{t("invitations.subtitle")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-caption text-muted-foreground">{t("invitations.invitedBy", { name: i.invited_by.display_name })}</div>
              <div className="truncate text-body font-medium text-foreground">
                {i.organization.name} › {i.workspace.name}
              </div>
              <div className="truncate font-mono text-caption text-muted-foreground">
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
