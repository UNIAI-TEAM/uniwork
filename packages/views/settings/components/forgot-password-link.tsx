"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { paths } from "@uniwork/core/paths";
import { getDesktopBridge } from "@uniwork/core/platform";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_LINK } from "../../auth/auth-controls";
import { AppLink, useNavigation } from "../../navigation";

const noopSubscribe = () => () => {};

/**
 * "Quên mật khẩu?" in a signed-in password field (the proof dialog, "Đổi
 * mật khẩu"). The forgot page comes back to this tab: its "Về trang đăng
 * nhập" goes through /login's resolver, which sends a signed-in person on
 * to `next`, and its field starts on the account's own address. In the
 * UniChat shell the window is the chat app, so the page opens in the
 * browser instead, as "Liên kết trên web" does.
 */
export function ForgotPasswordLink({ children }: { children: ReactNode }) {
  const nav = useNavigation();
  const bridge = useSyncExternalStore(noopSubscribe, getDesktopBridge, () => null);
  const href = paths.forgotPassword({ next: `${nav.pathname}?tab=security` });
  return (
    <AppLink
      href={href}
      className={cn(AUTH_LINK, "text-caption")}
      onClick={(e) => {
        if (!bridge) return;
        e.preventDefault();
        void bridge.openExternal(runtimeConfig().appUrl + href);
      }}
    >
      {children}
    </AppLink>
  );
}
