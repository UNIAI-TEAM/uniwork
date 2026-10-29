"use client";

import { useId, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore, useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useNavigation } from "../../navigation";

/**
 * The UniChat shell opened the security tab for its own account
 * (`expect_user`, its "Liên kết trên web"), and this browser is signed in
 * to another. Whatever is pressed on the tab would change that other
 * account: a link, the password, two-factor, a session, the account itself.
 * `heldBy` is the warning's id while that is so (every command on the tab
 * holds, described by it), undefined once the accounts match.
 */
export function useOtherBrowserAccount(): { heldBy: string | undefined; warning: ReactNode } {
  const user = useAuthStore((s) => s.user);
  const nav = useNavigation();
  const id = useId();
  const expected = nav.searchParams.get("expect_user");
  if (!user || !expected || expected === user.id) return { heldBy: undefined, warning: null };
  return { heldBy: id, warning: <OtherBrowserAccount id={id} email={user.email} expected={expected} /> };
}

/**
 * Said once, at the top of the tab, before anything is pressed, with the
 * way out. The way out comes back to the page UniChat opened, never to this
 * URL: /settings has already sent the other account on to its own
 * workspace, which the UniChat account signing in may not belong to.
 * /settings finds that account's own home again, `expect_user` kept.
 */
function OtherBrowserAccount({ id, email, expected }: { id: string; email: string; expected: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.signInMethods" });
  const nav = useNavigation();
  const logout = useLogout();
  const back = paths.securitySettings({ expectUser: expected });
  return (
    // Part of what the page says from the start, not news: a note, read in its place.
    <Alert id={id} variant="warning" role="note">
      <TriangleAlert aria-hidden />
      <AlertTitle className="[overflow-wrap:anywhere]">{t("browserOtherAccount", { other: email })}</AlertTitle>
      <AlertDescription className="text-pretty">{t("browserOtherAccountHint")}</AlertDescription>
      <div className="col-start-2 mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-busy={logout.isPending || undefined}
          aria-disabled={logout.isPending || undefined}
          onClick={() => {
            if (logout.isPending) return;
            // Signing out drops the user before the call settles, which
            // unmounts this warning and mutate's own callbacks with it; the
            // promise still lands.
            void logout
              .mutateAsync()
              .catch(() => undefined)
              .then(() => nav.replace(paths.login({ next: back })));
          }}
        >
          {logout.isPending ? <Spinner /> : null}
          {t("signOut")}
        </Button>
      </div>
    </Alert>
  );
}
