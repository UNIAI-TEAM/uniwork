"use client";

import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AuthShell } from "../auth/auth-shell";
import { AppLink } from "../navigation";
import { OnboardingLogoutButton } from "../onboarding/components/onboarding-logout-button";

/**
 * The full-page notice the shell shows in place of an organization it may
 * not open (a deactivated membership, a suspended organization). Both share
 * one layout so they cannot drift apart, and it is the entry screens' own
 * frame: someone locked out is back at the door, and gets what every other
 * door has — the lockup, a real page heading, the tab title and the language
 * switch.
 *
 * Not an alert: on a page load the heading is the announcement, as on every
 * other entry screen. `announce` is for the notice swapped in mid-task, when
 * the page the person was using is gone; its heading then takes focus. With
 * no `title` the shell shows its loading frame, so the deliberate silence
 * while the guard tells a suspension from a closure is not a blank page.
 *
 * The way on, when there is one, is the one primary action; signing out
 * stays below it for whoever signed in with the wrong account.
 */
export function AccessNoticePage({
  title,
  description,
  linkLabel,
  announce = false,
}: {
  title?: string;
  description?: string;
  /** The link to /get-started; absent when that page offers this person no way on. */
  linkLabel?: string;
  announce?: boolean;
}) {
  return (
    <AuthShell title={title} description={description} announce={announce}>
      {title === undefined ? null : (
        <div className="flex flex-col gap-4">
          {linkLabel ? (
            <AppLink href={paths.getStarted()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              {linkLabel}
            </AppLink>
          ) : null}
          <OnboardingLogoutButton className="self-start" />
        </div>
      )}
    </AuthShell>
  );
}
