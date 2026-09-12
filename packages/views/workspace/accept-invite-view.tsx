"use client";
import { Link2Off, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useAcceptInvite } from "@uniwork/core/workspaces";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_LINK } from "../auth/login-view";
import { AuthShell } from "../auth/auth-shell";
import { AppLink } from "../navigation";

/**
 * Lời mời hỏng là chuyện thường: link đã dùng, đã bị thu hồi, hoặc gõ sai. Bản
 * cũ đổ thẳng `message` của server ra màn hình, nên người dùng Việt nhận đúng
 * hai chữ "not found" trên một trang trắng không logo, không lối đi tiếp.
 *
 * Mỗi mã lỗi server trả về được dịch sang một câu nói rõ chuyện gì và làm gì
 * tiếp; mã lạ rơi về câu chung thay vì lộ chuỗi tiếng Anh.
 */
function reasonKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "not_found" || error.status === 404) return "gone";
    if (error.code === "member_deactivated") return "deactivated";
    if (error.code === "organization_suspended") return "suspended";
    if (error.status === 429) return "rateLimited";
  }
  return "failed";
}

export function AcceptInviteView({
  token,
  onAccepted,
  onAnon,
}: {
  token: string;
  /**
   * `workspace` is null for an invitation to the organization itself: the
   * person is in the company but in no team yet, so the host sends them to the
   * workspace picker instead of into a workspace (F-03).
   */
  onAccepted: (workspace: Workspace | null) => void;
  onAnon: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSession();
  const accept = useAcceptInvite();
  const fired = useRef(false);

  useEffect(() => {
    if (status === "anon") onAnon();
    if (status === "authed" && !fired.current) {
      fired.current = true;
      accept.mutate(token, {
        onSuccess: (result) => onAccepted(result.workspace),
      });
    }
  }, [status, token, accept, onAccepted, onAnon]);

  if (accept.error) {
    const reason = reasonKey(accept.error);
    return (
      <AuthShell title={t("workspace.acceptInviteError.title")} description={t(`workspace.acceptInviteError.${reason}`)}>
        <div className="flex flex-col gap-6">
          {/* role="alert": trạng thái đổi từ "đang tham gia" sang lỗi mà không
              có điều hướng, nên trình đọc màn hình cần được báo. */}
          <p className="flex items-start gap-3 text-body text-muted-foreground" role="alert">
            <Link2Off aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t("workspace.acceptInviteError.hint")}
          </p>
          <div className="flex flex-col gap-4">
            {/* Link đội lốt nút chính: nó điều hướng, nên giữ là <a> cho trình
                đọc màn hình thay vì Button bị đổi role. */}
            <AppLink href={paths.workspaces()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              {t("workspace.acceptInviteError.goToWorkspaces")}
            </AppLink>
            <p className="text-center text-body text-muted-foreground">
              <AppLink href={paths.login()} className={AUTH_LINK}>
                {t("auth.forgot.backToLogin")}
              </AppLink>
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("workspace.acceptInviteJoining.title")} description={t("workspace.acceptInviteJoining.body")}>
      <p className="flex items-center gap-3 text-body text-muted-foreground" role="status" aria-live="polite">
        <Loader2 aria-hidden className="size-5 shrink-0 animate-spin" />
        {t("common.loading")}
      </p>
    </AuthShell>
  );
}
