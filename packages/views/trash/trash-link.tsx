"use client";

import { Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";

/** The header action that opens a module's trash; icon-only below md, like the other header actions. */
export function TrashLink({ href }: { href: string }) {
  const { t } = useTranslation();
  return (
    <AppLink
      href={href}
      aria-label={t("trash.title")}
      className={cn(buttonVariants({ variant: "toolbar", size: "sm" }), "h-8 w-8 gap-1 px-0 md:w-auto md:px-2.5")}
    >
      <Trash aria-hidden className="size-3.5" />
      <span className="hidden md:inline">{t("trash.title")}</span>
    </AppLink>
  );
}
