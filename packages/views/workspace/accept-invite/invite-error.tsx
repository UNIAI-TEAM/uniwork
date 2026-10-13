"use client";
import { Link2Off } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_LINK } from "../../auth/login-view";
import { AuthShell } from "../../auth/auth-shell";
import { AppLink } from "../../navigation";

/**
 * Lời mời hỏng là chuyện thường: link đã dùng, đã bị thu hồi, hoặc gõ sai. Bản
 * cũ đổ thẳng `message` của server ra màn hình, nên người dùng Việt nhận đúng
 * hai chữ "not found" trên một trang trắng không logo, không lối đi tiếp.
 *
 * Mỗi mã lỗi server trả về được dịch sang một câu nói rõ chuyện gì và làm gì
 * tiếp; mã lạ (và một response hỏng, `null`) rơi về câu chung thay vì lộ chuỗi
 * tiếng Anh.
 */
function reasonKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "not_found" || error.status === 404) return "gone";
    if (error.code === "member_deactivated") return "deactivated";
    // The link was opened under an account other than the address it was
    // sent to; the server refuses it so a forwarded link cannot be redeemed
    // by whoever it reaches.
    if (error.code === "invitation_email_mismatch") return "wrongAccount";
    // Only an account that has proven the invited address may redeem it, so
    // the code sent at sign-up comes first.
    if (error.code === "email_unverified") return "unverified";
    if (error.code === "organization_suspended") return "suspended";
    // An organization waiting out its deletion takes nobody new: joining it
    // would leave the person in an organization every gate refuses them.
    if (error.code === "organization_deletion_scheduled") return "deletionScheduled";
    if (error.status === 429) return "rateLimited";
  }
  return "failed";
}

/** The line under the reason: what to do next, where it differs from the generic one. */
const HINT_KEY: Record<string, string> = {
  wrongAccount: "workspace.acceptInviteError.wrongAccountHint",
  unverified: "workspace.acceptInviteError.unverifiedHint",
};

export function InviteErrorScreen({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const logout = useLogout();
  const reason = reasonKey(error);
  return (
    <AuthShell title={t("workspace.acceptInviteError.title")} description={t(`workspace.acceptInviteError.${reason}`)}>
      <div className="flex flex-col gap-6">
        {/* role="alert": trạng thái đổi từ "đang tải" sang lỗi mà không có
            điều hướng, nên trình đọc màn hình cần được báo. */}
        <p className="flex items-start gap-3 text-body text-muted-foreground" role="alert">
          <Link2Off aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t(HINT_KEY[reason] ?? "workspace.acceptInviteError.hint")}
        </p>
        <div className="flex flex-col gap-4">
          {/* Signing out lands on login with this invite as `next` (onAnon),
              so the invitee comes straight back after switching account. */}
          {reason === "wrongAccount" ? (
            <Button size="lg" className="w-full" onClick={() => logout.mutate()} aria-disabled={logout.isPending}>
              {t("workspace.acceptInviteError.switchAccount")}
            </Button>
          ) : null}
          {reason === "unverified" ? (
            <AppLink href={paths.verify()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              {t("workspace.acceptInviteError.verifyEmail")}
            </AppLink>
          ) : null}
          {/* Link đội lốt nút chính: nó điều hướng, nên giữ là <a> cho trình
              đọc màn hình thay vì Button bị đổi role. */}
          <AppLink
            href={paths.workspaces()}
            className={cn(buttonVariants({ size: "lg", variant: reason in HINT_KEY ? "outline" : "default" }), "w-full")}
          >
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
