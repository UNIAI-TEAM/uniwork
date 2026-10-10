"use client";

import { TriangleAlert, Info, LockKeyhole, WifiOff, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProtocolErrorShape } from "@uniwork/core/office/docs-frame-protocol";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice, type NoticeTone } from "../../common/notice";

/**
 * Why the frame could not open, as the reader needs it: the editor is not
 * available on this deployment (no retry helps), the network dropped, the
 * document is out of reach, or something actually broke.
 */
type DocsFrameFailureKind = "unavailable" | "network" | "denied" | "failed";

// Server answers that mean "this deployment has no frame backend", not a crash.
const UNAVAILABLE_API_CODES = new Set(["storage_unavailable", "office_not_configured"]);

const DESCRIBED = new Set(["unauthorized", "rate_limited", "timeout", "busy", "feature_disabled"]);

function docsFrameFailureKind(failure: ProtocolErrorShape | null): DocsFrameFailureKind {
  const apiCode = failure?.details?.["apiCode"];
  if (failure?.code === "unsupported" || (typeof apiCode === "string" && UNAVAILABLE_API_CODES.has(apiCode))) return "unavailable";
  if (failure?.code === "network") return "network";
  if (failure?.code === "forbidden" || failure?.code === "not_found") return "denied";
  return "failed";
}

const VIEW: Record<DocsFrameFailureKind, { icon: LucideIcon; tone: NoticeTone }> = {
  unavailable: { icon: Info, tone: "info" },
  network: { icon: WifiOff, tone: "destructive" },
  denied: { icon: LockKeyhole, tone: "destructive" },
  failed: { icon: TriangleAlert, tone: "destructive" },
};

export interface DocsFrameFailureProps {
  failure: ProtocolErrorShape | null;
  /** Error code to describe; `feature_disabled` overrides the transport's own. */
  code: string;
  onRetry: () => void;
  /** Open the document in the standard editor instead; offered when the frame is unavailable. */
  onUseStandardEditor?: (() => void) | null;
  className?: string;
}

/** The frame's failed state, laid out like the G3 editor's (`DocxErrorState`). */
export function DocsFrameFailure({ failure, code, onRetry, onUseStandardEditor, className }: DocsFrameFailureProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame" });
  const kind = code === "feature_disabled" ? "unavailable" : docsFrameFailureKind(failure);
  const { icon, tone } = VIEW[kind];
  const title = t(`failure.${kind}.title`);
  const body = kind === "unavailable" && code === "feature_disabled"
    ? t("errors.feature_disabled")
    : kind === "denied"
      ? t(`failure.denied.${code === "not_found" ? "not_found" : "forbidden"}`)
      : kind === "failed" && DESCRIBED.has(code)
        ? t(`errors.${code}`)
        : t(`failure.${kind}.description`);
  const fallback = kind === "unavailable" ? onUseStandardEditor : null;
  return (
    <section
      className={cn("flex min-h-64 flex-1 items-center justify-center p-6", className)}
      data-office-docs-frame
      data-state="failed"
    >
      <Notice tone={tone} icon={icon} layout="inline" live="assertive" className="w-full max-w-xl">
        <div className="space-y-1" data-testid="office-docs-frame-failed" data-failure-kind={kind}>
          <p className="text-body font-semibold">{title}</p>
          <p>{body}</p>
          {fallback ? (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={fallback}>
              {t("failure.unavailable.use_standard")}
            </Button>
          ) : kind === "unavailable" ? null : (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              {t("retry")}
            </Button>
          )}
        </div>
      </Notice>
    </section>
  );
}
