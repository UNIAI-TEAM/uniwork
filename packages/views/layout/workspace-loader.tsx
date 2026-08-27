"use client";

import { Logo } from "@uniwork/ui/brand";
import { useTranslation } from "react-i18next";

/**
 * Full-screen workspace gate while the shell resolves the workspace from the URL.
 * Renders instead of the dashboard — sidebar and content do not mount behind it.
 */
export function WorkspaceLoader({ name }: { name?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background" aria-live="polite" role="status">
      <div className="flex flex-col items-center gap-4">
        <Logo variant="mark" size={32} decorative className="animate-pulse" />
        <p className="text-body text-muted-foreground">
          {name ? (
            <>
              {t("common.loading")}{" "}
              <span className="font-medium text-foreground">{name}</span>…
            </>
          ) : (
            t("common.loading")
          )}
        </p>
      </div>
    </div>
  );
}
