"use client";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMyInvitations } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { AuthShell } from "../auth/auth-shell";
import { OnboardingLogoutButton } from "../onboarding/components/onboarding-logout-button";
import { InvitationList, InvitationListError, InvitationListSkeleton } from "./invitation-list";

/**
 * Danh sách lời mời đang chờ của user. Mỗi dòng mở trang của chính lời mời đó:
 * tham gia chỉ có một luồng, nơi người đang thuộc tổ chức khác được cho thấy
 * việc chuyển tổ chức sẽ đổi gì (ADR 0032). Vì vậy không còn "Tham gia tất cả":
 * một tài khoản chỉ thuộc một tổ chức.
 *
 * Cùng AuthShell với /get-started và /invite/{token}: đây là bước ngay sau
 * đăng nhập, nên phải trông như cùng một mạch. Tiêu đề không đổi giữa lúc tải,
 * lỗi và có dữ liệu, để AuthShell không kéo focus lên heading khi dữ liệu về.
 * "Để sau" và "Đăng xuất" là lối ra cho người không muốn lời mời nào ở đây,
 * hoặc đang đăng nhập nhầm tài khoản.
 */
export function InvitationsView({ onEmpty, onSkip }: { onEmpty: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const { data: invites, isFetched, isError, refetch, isRefetching } = useMyInvitations();
  useEffect(() => {
    if (isFetched && invites && invites.length === 0) onEmpty();
  }, [isFetched, invites, onEmpty]);

  let body;
  if (isError) {
    body = <InvitationListError onRetry={() => void refetch()} busy={isRefetching} />;
  } else if (invites?.length) {
    body = <InvitationList invitations={invites} label={t("invitations.list_title")} />;
  } else {
    // Loading, and the moment between an empty answer and onEmpty's redirect:
    // the list's shape, never a blank page.
    body = <InvitationListSkeleton rows={2} />;
  }

  return (
    <AuthShell title={t("invitations.list_title")} description={t("invitations.subtitle")}>
      <div className="flex flex-col gap-6">
        {body}
        {/* Both exits on one quiet row, each against its own edge: the
            ghost buttons' -ml-2 / -mr-2 put their text on the column's
            edges, where the list's frame is. */}
        <div className="flex items-center justify-between gap-3">
          <OnboardingLogoutButton />
          <Button type="button" variant="ghost" size="sm" className="-mr-2" onClick={onSkip}>
            {t("common.later")}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
