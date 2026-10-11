"use client";

import { TriangleAlert, Info, LockKeyhole, WifiOff, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProtocolErrorShape } from "@uniwork/core/office/docs-frame-protocol";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { Notice, type NoticeTone } from "../../common/notice";
import { OfficeFileActions, useOfficeDesktopActionAvailable } from "../too-large-notice";

/**
 * Why the frame could not open, as the reader needs it: the editor is not
 * available on this deployment (no retry helps), the network dropped, the
 * document is out of reach, the editor's own files did not load, or
 * something actually broke.
 */
type DocsFrameFailureKind = "unavailable" | "load" | "network" | "denied" | "failed";

// Server answers that mean "this deployment has no frame backend", not a crash.
const UNAVAILABLE_API_CODES = new Set(["storage_unavailable", "office_not_configured"]);

const DESCRIBED = new Set(["unauthorized", "rate_limited", "timeout", "busy", "feature_disabled"]);

function docsFrameFailureKind(failure: ProtocolErrorShape | null): DocsFrameFailureKind {
  const apiCode = failure?.details?.["apiCode"];
  if (failure?.details?.["frameBundle"] !== undefined) return "load";
  if (failure?.code === "unsupported" || (typeof apiCode === "string" && UNAVAILABLE_API_CODES.has(apiCode))) return "unavailable";
  if (failure?.code === "network") return "network";
  if (failure?.code === "forbidden" || failure?.code === "not_found") return "denied";
  return "failed";
}

const VIEW: Record<DocsFrameFailureKind, { icon: LucideIcon; tone: NoticeTone }> = {
  unavailable: { icon: Info, tone: "info" },
  load: { icon: TriangleAlert, tone: "destructive" },
  network: { icon: WifiOff, tone: "destructive" },
  denied: { icon: LockKeyhole, tone: "destructive" },
  failed: { icon: TriangleAlert, tone: "destructive" },
};

export interface DocsFrameFailureProps {
  failure: ProtocolErrorShape | null;
  /** Error code to describe; `feature_disabled` overrides the transport's own. */
  code: string;
  onRetry: () => void;
  /** Where the document list lives; a denied reader gets a way back there instead of a retry. */
  libraryHref?: string;
  /** The genoffice module that failed, for tests and diagnostics (data-office-module). */
  module?: string;
  className?: string;
}

/**
 * The frame's failed state. Every failure but a denial also offers the host's
 * "Open in UniWork Office" and "Download" (`OfficeFileActions`): the web has no
 * other editor to fall back to.
 */
export function DocsFrameFailure({ failure, code, onRetry, libraryHref, module, className }: DocsFrameFailureProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const kind = code === "feature_disabled" ? "unavailable" : docsFrameFailureKind(failure);
  const { icon, tone } = VIEW[kind];
  // The copy that points at UniWork Office has a download-only wording for when the app is not offered.
  const desktop = useOfficeDesktopActionAvailable();
  const title = t(`failure.${kind}.title`);
  const body = kind === "unavailable" && code === "feature_disabled"
    ? t(desktop ? "errors.feature_disabled" : "failure.feature_disabled_download_only")
    : kind === "denied"
      ? t(`failure.denied.${code === "not_found" ? "not_found" : "forbidden"}`)
      : kind === "failed" && DESCRIBED.has(code)
        ? t(`errors.${code}`)
        : (kind === "unavailable" || kind === "load") && !desktop
          ? t(`failure.${kind}.description_download_only`)
          : t(`failure.${kind}.description`);
  // Trying again cannot change a permission answer (or a deployment without the editor): a denial
  // names its reason and offers the way back to the list, nothing else.
  const canRetry = kind !== "unavailable";
  return (
    <section
      className={cn("flex min-h-64 flex-1 items-center justify-center p-6", className)}
      data-office-docs-frame
      data-office-module={module}
      data-state="failed"
    >
      <Notice tone={tone} icon={icon} layout="inline" live="assertive" className="w-full max-w-xl">
        <div className="space-y-1" data-testid="office-docs-frame-failed" data-failure-kind={kind}>
          <p className="text-body font-semibold">{title}</p>
          <p>{body}</p>
          {kind === "denied" ? (libraryHref ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <AppLink href={libraryHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("failure.denied.back_to_library")}
              </AppLink>
            </div>
          ) : null) : (
            <div className="mt-2 space-y-1">
              <OfficeFileActions
                leading={canRetry ? (
                  <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    {t("retry")}
                  </Button>
                ) : null}
              />
            </div>
          )}
        </div>
      </Notice>
    </section>
  );
}
