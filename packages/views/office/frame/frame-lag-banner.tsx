"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FileExclamationPoint } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocumentLimits } from "@uniwork/core/documents/limits";
import {
  dismissLagBanner,
  isLagBannerDismissed,
  shouldShowSizeFallbackLagBanner,
  supportsLagPerformanceObserver,
} from "@uniwork/core/office";
import {
  parseEnvelope,
  type OfficeModule,
  type OpenRefusedPayload,
} from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";

export interface UseFrameLagBannerOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  frameOrigin: string;
  module: OfficeModule;
  documentId: string;
  fileSizeBytes?: number | null;
  hasLagObserver?: () => boolean;
  lagStorage?: Pick<StorageAdapter, "getItem" | "setItem">;
}

export interface FrameLagBannerController {
  openRefused: OpenRefusedPayload | null;
  shouldShow: (ready: boolean) => boolean;
  dismiss: () => void;
  rebindDocument: (nextDocumentId: string) => void;
  resetAttempt: () => void;
}

/**
 * LAG-W1: non-blocking lag banner (`lag_detected` from the frame, or size
 * fallback at open when `PerformanceObserver` lacks `longtask`/`event`) and
 * `open_refused` notice state for one module frame.
 */
export function useFrameLagBanner({
  iframeRef,
  frameOrigin,
  module,
  documentId,
  fileSizeBytes,
  hasLagObserver = supportsLagPerformanceObserver,
  lagStorage = defaultStorage,
}: UseFrameLagBannerOptions): FrameLagBannerController {
  const { web_open: webOpen } = useDocumentLimits();
  const format = officeModuleSpec(module).format;
  const [activeDocId, setActiveDocId] = useState(documentId);
  const [lagTriggered, setLagTriggered] = useState(false);
  const [dismissedInMemory, setDismissedInMemory] = useState(() => isLagBannerDismissed(documentId, lagStorage));
  const [openRefused, setOpenRefused] = useState<OpenRefusedPayload | null>(null);

  const latest = useRef({ activeDocId, lagStorage });
  latest.current = { activeDocId, lagStorage };

  // Reset per-document state when the documentId prop changes.
  useEffect(() => {
    setActiveDocId(documentId);
    setLagTriggered(false);
    setDismissedInMemory(isLagBannerDismissed(documentId, latest.current.lagStorage));
    setOpenRefused(null);
  }, [documentId]);

  // Listen to inbound `lag_detected` and `open_refused` frame events on the same-origin channel.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== frameOrigin) return;
      const peer = iframeRef.current?.contentWindow ?? null;
      if (!peer || ev.source !== peer) return;
      const parsed = parseEnvelope(ev.data);
      if (!parsed.ok || parsed.message.kind !== "event") return;
      const msg = parsed.message;
      if (msg.type === "lag_detected") {
        const { activeDocId: doc, lagStorage: storage } = latest.current;
        if (!isLagBannerDismissed(doc, storage)) setLagTriggered(true);
      } else if (msg.type === "open_refused") {
        setOpenRefused(msg.payload as OpenRefusedPayload);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameOrigin, iframeRef]);

  const dismissed = dismissedInMemory || isLagBannerDismissed(activeDocId, lagStorage);

  const shouldShow = (ready: boolean): boolean => {
    if (!ready || dismissed) return false;
    if (lagTriggered) return true;
    return shouldShowSizeFallbackLagBanner({
      format,
      sizeBytes: fileSizeBytes,
      webOpen,
      hasObserver: hasLagObserver(),
    });
  };

  const dismiss = useCallback(() => {
    const { activeDocId: doc, lagStorage: storage } = latest.current;
    dismissLagBanner(doc, storage);
    setDismissedInMemory(true);
    setLagTriggered(false);
  }, []);

  const rebindDocument = useCallback((nextDocumentId: string) => {
    setActiveDocId(nextDocumentId);
    setDismissedInMemory(isLagBannerDismissed(nextDocumentId, latest.current.lagStorage));
  }, []);

  const resetAttempt = useCallback(() => {
    setLagTriggered(false);
    setOpenRefused(null);
  }, []);

  return {
    openRefused,
    shouldShow,
    dismiss,
    rebindDocument,
    resetAttempt,
  };
}

export function FrameLagBanner({
  open,
  onOpenApp,
  onContinue,
}: {
  open: boolean;
  onOpenApp?: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.lag_banner" });
  if (!open || !onOpenApp) return null;
  return (
    <div data-testid="office-lag-banner">
      <Notice tone="warning" icon={FileExclamationPoint} layout="strip">
        {/* Below `sm` the actions sit under the text instead of squeezing it into a narrow column. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="min-w-0">{t("body")}</span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" size="xs" variant="default" onClick={onOpenApp}>
              {t("open_app")}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={onContinue}>
              {t("continue")}
            </Button>
          </div>
        </div>
      </Notice>
    </div>
  );
}
