"use client";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import { paths } from "@uniwork/core/paths";
import { useMyInvitations } from "@uniwork/core/workspaces";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { AppLink } from "../navigation";

/**
 * Danh sách lời mời đang chờ của user. Mỗi dòng mở trang của chính lời mời đó:
 * tham gia chỉ có một luồng, nơi người đang thuộc tổ chức khác được cho thấy
 * việc chuyển tổ chức sẽ đổi gì (ADR 0032). Vì vậy không còn "Tham gia tất cả":
 * một tài khoản chỉ thuộc một tổ chức.
 */
export function InvitationsView({ onEmpty }: { onEmpty: () => void }) {
  const { t } = useTranslation();
  const { data: invites, isFetched } = useMyInvitations();
  useEffect(() => {
    if (isFetched && invites && invites.length === 0) onEmpty();
  }, [isFetched, invites, onEmpty]);
  if (!invites?.length) return null;

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
                {i.organization.name}
                {i.workspace && <> › {i.workspace.name}</>}
              </div>
              <div className="truncate font-mono text-caption text-muted-foreground">
                {appHost()}/{i.organization.slug}
                {i.workspace && <>/{i.workspace.slug}</>} · {t("invitations.role", { role: i.role })}
              </div>
            </div>
            {/* A link dressed as a button: it navigates. The label names the
                organization, so a list of "Xem" reads apart by ear. */}
            <AppLink
              href={paths.invite(i.token)}
              aria-label={t("invitations.viewLabel", { name: i.organization.name })}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("invitations.view")}
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
