"use client";
import { CircleAlert, Copy, Ellipsis, Link, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { inviteLinkStatus, useInviteLinks, useRevokeInviteLink } from "@uniwork/core/meetings";
import type { MeetingInviteLink } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../../toast-api-error";
import { CreateInviteLinkDialog, type InviteLinkDraft } from "../../create-invite-link-dialog";
import { inviteLinkUrl } from "../../invite-link-url";
import { useDetail } from "../detail-context";
import { clock, shortDay } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { NoticeLine } from "../ui/notice-line";
import { Dialog440 } from "../ui/overlay";
import { Section } from "../ui/section";
import { TextButton } from "../ui/text-button";

/** "Chủ trì duyệt · 0/5 lượt · hết hạn 07:00 T7 31/10" (kit `.guest-meta`: the count in `.num`, the hour in `<time>`). */
function GuestMeta({ link }: { link: MeetingInviteLink }) {
  const { t } = useTranslation();
  const { now } = useDetail();
  const num = <span className="tabular-nums" />;
  return (
    <>
      {t(link.access_mode === "REQUEST_APPROVAL" ? "meetings.detail.guestLink.modeApproval" : "meetings.detail.guestLink.modeAuto")}
      {" · "}
      {link.max_uses != null ? (
        <Trans t={t} i18nKey="meetings.detail.guestLink.uses" values={{ used: link.used_count, max: link.max_uses }} components={{ num }} />
      ) : (
        <Trans t={t} i18nKey="meetings.detail.guestLink.usesOpen" values={{ count: link.used_count }} components={{ num }} />
      )}
      {" · "}
      <Trans
        t={t}
        i18nKey="meetings.detail.guestLink.expires"
        values={{ time: clock(link.expires_at), day: shortDay(link.expires_at, now, t) }}
        components={{ time: <time dateTime={link.expires_at} /> }}
      />
    </>
  );
}

function GuestLinkRow({
  link,
  onRevoke,
  onRecreate,
}: {
  link: MeetingInviteLink;
  onRevoke: () => void;
  onRecreate: () => void;
}) {
  const { t } = useTranslation();
  const secret = link.secret;
  const copy = async () => {
    if (!secret) return;
    if (await copyText(inviteLinkUrl(link.id, secret))) toast.success(t("meetings.linkCopied"), { position: "bottom-center" });
    else toast.error(t("common.error"), { position: "bottom-center" });
  };
  const small = cn(kitButton.sm, kitButton.outline);
  return (
    <li className="-mx-2 grid min-h-13 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 hover:bg-surface-hover @max-[37.5rem]/meeting:grid-cols-[16px_minmax(0,1fr)] @max-[37.5rem]/meeting:gap-y-2">
      <Link aria-hidden className="size-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-body font-medium">{link.name}</p>
        <p className="mt-0.5 text-caption text-muted-foreground tabular-nums">
          <GuestMeta link={link} />
        </p>
      </div>
      <div className="flex items-center gap-1 @max-[37.5rem]/meeting:col-start-2">
        {secret ? (
          <Button type="button" variant="outline" className={small} onClick={() => void copy()}>
            <Copy aria-hidden />
            {t("meetings.detail.guestLink.copy")}
          </Button>
        ) : (
          // A link made before the secret could be derived again cannot be copied: offer a fresh one.
          <Button
            type="button"
            variant="outline"
            className={small}
            aria-label={t("meetings.detail.guestLink.newFor", { name: link.name })}
            onClick={onRecreate}
          >
            <Plus aria-hidden />
            {t("meetings.newInviteLink")}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("rounded-md", kitButton.ghost)}
                aria-label={t("meetings.detail.guestLink.more", { name: link.name })}
              />
            }
          >
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-50">
            <DropdownMenuItem variant="destructive" className="h-9 gap-2 px-2.5" onClick={onRevoke}>
              {t("meetings.revokeLinkConfirm")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/**
 * "Khách bên ngoài" (ScheduledHost): one row per active guest link, never a
 * card. Host and admin only — `useInviteLinks` answers 403 to anyone else, so
 * the caller mounts it behind `sections.guestLinks`. A link the server cannot
 * show again offers a fresh one with the same settings instead of a copy.
 */
export function GuestLinks({ bare = false }: { bare?: boolean } = {}) {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  const query = useInviteLinks(meeting.id);
  const revoke = useRevokeInviteLink(meeting.id);
  const [revoking, setRevoking] = useState<MeetingInviteLink | null>(null);
  const [draft, setDraft] = useState<InviteLinkDraft | null>(null);
  const now = new Date();
  const active = (query.data ?? []).filter((link) => inviteLinkStatus(link, now) === "active");

  const dialogs = (
    <>
      <Dialog440
        role="alertdialog"
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("meetings.revokeLinkTitle", { name: revoking?.name ?? "" })}
        description={t("meetings.revokeLinkHint")}
        footer={
          <>
            <Button type="button" variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost)} onClick={() => setRevoking(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructiveSolid"
              size="lg"
              className={kitButton.base}
              aria-disabled={revoke.isPending || undefined}
              onClick={() => {
                if (!revoking || revoke.isPending) return;
                revoke.mutate(revoking.id, {
                  onSuccess: () => setRevoking(null),
                  onError: (err) => toastApiError(err, t("common.error")),
                });
              }}
            >
              {t("meetings.revokeLinkConfirm")}
            </Button>
          </>
        }
      />
      <CreateInviteLinkDialog
        key={JSON.stringify(draft)}
        meetingId={meeting.id}
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        initial={draft ?? undefined}
      />
    </>
  );

  if (query.isPending) return null;
  // `bare`: inside a drawer that already carries the heading (the live Khách drawer).
  const frame = (body: ReactNode) =>
    bare ? (
      <>{body}</>
    ) : (
      <Section id="khach" title={t("meetings.detail.guestLink.title")}>
        {body}
      </Section>
    );
  if (query.isError) {
    return frame(
      <NoticeLine tone="destructive" icon={CircleAlert} role="alert">
        {t("meetings.inviteLinksLoadFailed")}{" "}
        <TextButton onClick={() => void query.refetch()}>{t("common.retry")}</TextButton>
      </NoticeLine>,
    );
  }
  // No active link, no section (SeriesBrief): a new link comes from the edit sheet's guest links.
  if (active.length === 0) return null;
  return frame(
    <>
      <ul aria-label={t("meetings.detail.guestLink.title")}>
        {active.map((link) => (
          <GuestLinkRow
            key={link.id}
            link={link}
            onRevoke={() => setRevoking(link)}
            onRecreate={() =>
              setDraft({ name: link.name, mode: link.access_mode, maxUses: link.max_uses != null ? String(link.max_uses) : "" })
            }
          />
        ))}
      </ul>
      {dialogs}
    </>,
  );
}
