"use client";
import { ArrowLeft, CircleAlert, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { kitButton } from "./ui/kit-buttons";

// Desktop sits the message 31 above centre (kit `.crop-center .page-state` 48 below); a phone, 10 (kit @599 72/72 in a 20/48 page).
const STATE = "flex flex-1 flex-col items-center justify-center gap-3 px-4 pt-6 pb-[86px] text-center max-sm:pb-11 [&>svg]:size-6 [&>svg]:text-muted-foreground";
const outline = cn(kitButton.base, kitButton.outline, "mt-1");

/** The page could not load (kit `.page-state`, LoadingError crop 2): one line and a retry. */
export function DetailLoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={STATE}>
      <CircleAlert aria-hidden />
      <h1 className="text-title-sm font-semibold">{t("meetings.detail.states.loadFailed")}</h1>
      <Button type="button" size="lg" variant="outline" className={outline} onClick={onRetry}>
        <RefreshCw aria-hidden />
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** A meeting that does not exist and one the viewer may not see read the same (LoadingError crop 4). */
export function DetailNotFound({ listHref }: { listHref: string }) {
  const { t } = useTranslation();
  return (
    <div className={STATE}>
      <Search aria-hidden />
      <h1 className="text-title-sm font-semibold">{t("meetings.notFound")}</h1>
      <p className="-mt-2 max-w-90 text-caption text-muted-foreground">{t("meetings.detail.states.notFoundHint")}</p>
      <AppLink href={listHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), outline)}>
        <ArrowLeft aria-hidden />
        {t("meetings.backToList")}
      </AppLink>
    </div>
  );
}
