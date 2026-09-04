"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { inviteLinkStatus, useInviteLinks, useRevokeInviteLink } from "@uniwork/core/meetings";
import type { MeetingInviteLink } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { CreateInviteLinkDialog } from "./create-invite-link-dialog";
import { inviteLinkDisplayName, inviteLinkMetaParts } from "./invite-link-display";
import { MeetingPanelCard } from "./meeting-panel-card";
import { MeetingLinkBadge } from "./meeting-status-badge";

const VISIBLE_ACTIVE_LIMIT = 3;

function InviteLinkRow({
  link,
  language,
  onRevoke,
  revoking,
}: {
  link: MeetingInviteLink;
  language: string;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const { t } = useTranslation();
  const status = inviteLinkStatus(link, new Date());
  const title = inviteLinkDisplayName(link, language);
  const meta = inviteLinkMetaParts(link, language).join(" · ");

  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-foreground">{title}</div>
        <div className="text-caption text-muted-foreground">{meta}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <MeetingLinkBadge status={status} />
        {status === "active" ? (
          <Button size="sm" variant="outline" disabled={revoking} onClick={onRevoke}>
            {t("meetings.revokeLink")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function MeetingInviteLinksSection({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { data: links } = useInviteLinks(meetingId);
  const revoke = useRevokeInviteLink(meetingId);
  const [createOpen, setCreateOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showAllActive, setShowAllActive] = useState(false);

  const { activeLinks, inactiveLinks } = useMemo(() => {
    const all = links ?? [];
    const now = new Date();
    const active: MeetingInviteLink[] = [];
    const inactive: MeetingInviteLink[] = [];
    for (const link of all) {
      if (inviteLinkStatus(link, now) === "active") active.push(link);
      else inactive.push(link);
    }
    return { activeLinks: active, inactiveLinks: inactive };
  }, [links]);

  const visibleActive = showAllActive ? activeLinks : activeLinks.slice(0, VISIBLE_ACTIVE_LIMIT);
  const hiddenActiveCount = Math.max(0, activeLinks.length - VISIBLE_ACTIVE_LIMIT);

  return (
    <>
      <MeetingPanelCard
        id="invite-links-heading"
        title={t("meetings.inviteLink")}
        action={
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-2.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t("meetings.newInviteLink")}
          </Button>
        }
      >
        {activeLinks.length === 0 && inactiveLinks.length === 0 ? (
          <p className="text-label text-muted-foreground">{t("meetings.noInviteLinks")}</p>
        ) : null}

        {activeLinks.length > 0 ? (
          <>
            <ul className="-mx-4 -mt-4 divide-y divide-border border-b border-border">
              {visibleActive.map((link) => (
                <InviteLinkRow
                  key={link.id}
                  link={link}
                  language={i18n.language}
                  revoking={revoke.isPending}
                  onRevoke={() => revoke.mutate(link.id, { onError: (err) => toastApiError(err, t("common.error")) })}
                />
              ))}
            </ul>
            {hiddenActiveCount > 0 && !showAllActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-8 px-0 text-muted-foreground hover:text-foreground"
                onClick={() => setShowAllActive(true)}
              >
                {t("meetings.showAllActiveLinks", { count: activeLinks.length })}
              </Button>
            ) : null}
          </>
        ) : null}

        {inactiveLinks.length > 0 ? (
          <div className={activeLinks.length > 0 ? "mt-2" : undefined}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-muted-foreground hover:text-foreground"
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive
                ? t("meetings.hideInactiveLinks")
                : t("meetings.showInactiveLinks", { count: inactiveLinks.length })}
            </Button>
            {showInactive ? (
              <ul className="-mx-4 mt-1 divide-y divide-border border-y border-border bg-surface-hover/50">
                {inactiveLinks.map((link) => (
                  <InviteLinkRow
                    key={link.id}
                    link={link}
                    language={i18n.language}
                    revoking={revoke.isPending}
                    onRevoke={() => revoke.mutate(link.id, { onError: (err) => toastApiError(err, t("common.error")) })}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </MeetingPanelCard>

      <CreateInviteLinkDialog meetingId={meetingId} open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
