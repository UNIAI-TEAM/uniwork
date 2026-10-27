"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import type { DriveFile } from "@uniwork/core/drive-library";
import { useFlag } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { useAskUniOpener } from "../../ai/ask-uni-focus-button";
import { useOptionalNavigation } from "../../navigation";

export interface UseDriveAskUniSeamOptions {
  wsId: string;
  driveFileId: string;
  file: DriveFile | null;
  detailHref: string;
  onAsk?: (file: DriveFile) => void;
}

export interface DriveAskUniSeamState {
  showAsk: boolean;
  askGranted: boolean;
  askDisabled: boolean;
  triggerAsk: () => void;
  proposePopoverOpen: boolean;
  setProposePopoverOpen: (open: boolean) => void;
}

/**
 * Wires the Ask UNI opener and deep-link query params (`?propose=1` / `?ask=1`, spec §7.4, §7.11)
 * for 4.2 `/documents/drive/{driveFileId}`.
 */
export function useDriveAskUniSeam({
  wsId,
  driveFileId,
  file,
  detailHref,
  onAsk,
}: UseDriveAskUniSeamOptions): DriveAskUniSeamState {
  const nav = useOptionalNavigation();
  const askDocked = useFlag("ask_uni_stream", false);
  const aiCaps = useAiCapabilities(wsId, askDocked && wsId !== "");
  const defaultAskOpener = useAskUniOpener(
    {
      kind: "drive_file",
      id: file?.id ?? driveFileId,
      label: file?.name,
      accountEmail: file?.viewer_account_email || undefined,
      openUrl: file?.open_url,
    },
    wsId,
  );
  const hasDefaultAskOpener = Boolean(defaultAskOpener);
  const hasAskSeam = Boolean(onAsk || hasDefaultAskOpener);
  const askCapsPending = !hasAskSeam && askDocked && aiCaps.isPending;

  const searchParams = nav?.searchParams;
  const replace = nav?.replace;
  const proposeParam = searchParams?.get("propose") === "1";
  const askParam = searchParams?.get("ask") === "1";
  const handledProposeFileId = useRef<string | null>(null);
  const [proposePopoverOpen, setProposePopoverOpen] = useState(false);

  useEffect(() => {
    if (!proposeParam) {
      handledProposeFileId.current = null;
    }
  }, [proposeParam, driveFileId]);

  useEffect(() => {
    if (!file || (!proposeParam && !askParam)) return;
    if (proposeParam && file.can_propose && handledProposeFileId.current !== file.id) {
      handledProposeFileId.current = file.id;
      setProposePopoverOpen(true);
    }
    if (askParam && askCapsPending && !proposeParam) return;
    if (askParam && file.can_ask && file.viewer_access === "granted") {
      if (onAsk) onAsk(file);
      else defaultAskOpener?.();
    }
    if (replace && searchParams) {
      const next = new URLSearchParams(searchParams.toString());
      if (proposeParam) next.delete("propose");
      if (askParam && !askCapsPending) next.delete("ask");
      const qs = next.toString();
      replace(qs ? `${detailHref}?${qs}` : detailHref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultAskOpener is recreated per render; trigger once per file/param
  }, [file, proposeParam, askParam, askCapsPending, onAsk, hasDefaultAskOpener, replace, searchParams, detailHref]);
  const askGranted = file?.viewer_access === "granted";
  const showAsk = Boolean(file && hasAskSeam && (file.can_ask || !askGranted));
  const askDisabled = !askGranted || !file?.can_ask;

  const triggerAsk = () => {
    if (!file || askDisabled) return;
    if (onAsk) onAsk(file);
    else defaultAskOpener?.();
  };

  return {
    showAsk,
    askGranted,
    askDisabled,
    triggerAsk,
    proposePopoverOpen,
    setProposePopoverOpen,
  };
}

export interface DriveAskUniHeaderButtonProps {
  showAsk: boolean;
  askGranted: boolean;
  askDisabled: boolean;
  onTriggerAsk: () => void;
}

/**
 * §7.4 / §7.7 "Hỏi UNI" header button with `aria-disabled` + `aria-describedby` hint when `viewer_access !== 'granted'`.
 */
export function DriveAskUniHeaderButton({
  showAsk,
  askGranted,
  askDisabled,
  onTriggerAsk,
}: DriveAskUniHeaderButtonProps) {
  const { t } = useTranslation();

  if (!showAsk) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={askDisabled || undefined}
        aria-describedby={!askGranted ? "drive-detail-ask-access-hint" : undefined}
        onClick={askDisabled ? undefined : onTriggerAsk}
      >
        <Sparkles aria-hidden className="size-4" />
        {t("driveLibrary.detail.ask_uni")}
      </Button>
      {!askGranted ? (
        <span
          id="drive-detail-ask-access-hint"
          className="order-last basis-full text-right text-caption text-muted-foreground sm:order-none sm:basis-auto"
        >
          {t("driveLibrary.detail.access_required_hint")}
        </span>
      ) : null}
    </>
  );
}
