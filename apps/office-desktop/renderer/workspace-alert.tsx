import { useTranslation } from "react-i18next";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";

export interface WorkspaceAlertItem {
  id: string;
  message: string;
  /** Present only for one-off failures; ongoing state (session, checkpoint) stays until it resolves. */
  onDismiss?: () => void;
}

/** Failure strips laid over the top of the workspace. They are out of flow, so
 * showing or dismissing one never moves the page; only the strip itself takes
 * pointer events. The parent must be `relative`. */
export function WorkspaceAlerts({ items }: { items: readonly WorkspaceAlertItem[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.tabs" });
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-40 flex flex-col items-center gap-2 px-4" data-workspace-alerts="true">
      {items.map((item) => (
        <div key={item.id} role="alert" className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2 text-body text-destructive-soft-foreground shadow-md">
          <span className="mt-0.5"><TriangleAlert className="size-4 shrink-0" aria-hidden /></span>
          <p className="min-w-0 flex-1 break-words">{item.message}</p>
          {item.onDismiss ? <Button type="button" variant="ghost" size="icon-sm" aria-label={t("dismissAlert")} title={t("dismissAlert")} onClick={item.onDismiss}><X className="size-4 shrink-0" aria-hidden /></Button> : null}
        </div>
      ))}
    </div>
  );
}
