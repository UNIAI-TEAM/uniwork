"use client";

import type { LucideIcon } from "lucide-react";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";
import { OnboardingLogoutButton } from "../onboarding/components/onboarding-logout-button";

/**
 * The full-page notice the shell shows in place of an organization it may
 * not open (a deactivated membership, a suspended organization). Both lead
 * to /get-started, so they share one layout and cannot drift apart.
 *
 * `<main>` because nothing else on the page is a landmark; `min-h-dvh` so a
 * short or zoomed window scrolls instead of clipping the notice. The way on
 * is the one primary action; signing out stays beside it for whoever signed
 * in with the wrong account.
 */
export function AccessNoticePage({
  icon,
  title,
  description,
  linkLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  linkLabel: string;
}) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <CollectionPageState
        icon={icon}
        tone="warning"
        role="alert"
        title={title}
        description={description}
        actions={
          <div className="flex flex-col items-center gap-2">
            <AppLink href={paths.getStarted()} className={buttonVariants({ size: "lg" })}>
              {linkLabel}
            </AppLink>
            <OnboardingLogoutButton className="ml-0" />
          </div>
        }
      />
    </main>
  );
}
