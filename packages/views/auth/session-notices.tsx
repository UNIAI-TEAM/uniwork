"use client";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { linkSkippedNotice, sentenceValues } from "@uniwork/core/auth/sign-in-errors";
import type { SessionResponse } from "@uniwork/core/types";

/** Long enough to read a two-clause sentence once the next screen has painted. */
const NOTICE_MS = 10_000;

/**
 * What a session answer asks to be said once, after the sign-in it opened
 * (spec §3.1, §3.3): the account was taken back from whoever registered the
 * address without proving it (`reclaimed`), or the provider that waited to be
 * linked was not (`link_skipped`). A toast, because the screen that opened the
 * session is about to be replaced by the one it leads to; the global Toaster
 * outlives that navigation.
 */
export function useSessionNotices(): (
  sess: Pick<SessionResponse, "reclaimed" | "link_skipped">,
  /** The provider that waited to be linked, when the screen knows it (the choice screen, /login?link=1). */
  provider?: SignInProvider | null,
) => void {
  const { t } = useTranslation();
  return useCallback(
    (sess, provider) => {
      if (sess.reclaimed) toast.success(t("auth.social.reclaimed"), { duration: NOTICE_MS });
      const skipped = linkSkippedNotice(sess.link_skipped, provider);
      if (skipped) toast.warning(t(skipped.key, sentenceValues(skipped, t)), { duration: NOTICE_MS });
    },
    [t],
  );
}
