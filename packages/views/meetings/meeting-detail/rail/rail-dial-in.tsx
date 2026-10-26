"use client";
import { CircleAlert, Copy, Phone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingDialIn, useRotateMeetingDialInPin } from "@uniwork/core/meetings/dial-in";
import { Button } from "@uniwork/ui/components/ui/button";
import { apiErrorCopy } from "../../../api-error-copy";
import { useDetail } from "../detail-context";
import { kitButton } from "../ui/kit-buttons";
import { NoticeLine } from "../ui/notice-line";
import { Dialog440 } from "../ui/overlay";
import { RailProp } from "../ui/rail";
import { TextButton } from "../ui/text-button";
import { RailPopover, useRailPopover } from "./rail-popover";

/** A value to read aloud or type: copied whole, digits and all. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const copy = () => {
    // No clipboard outside a secure context: say so rather than do nothing.
    if (!navigator.clipboard) {
      toast.error(t("meetings.dialIn.copyFailed"), { position: "bottom-center" });
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("common.copied"), { position: "bottom-center" }))
      .catch(() => toast.error(t("meetings.dialIn.copyFailed"), { position: "bottom-center" }));
  };
  return (
    <Button type="button" size="icon-sm" variant="ghost" className={kitButton.icon} aria-label={label} onClick={copy}>
      <Copy aria-hidden />
    </Button>
  );
}

/**
 * "Gọi vào" (spec 2026-10-20-meeting-scribe-agent-design §5.4): the
 * deployment's number and the meeting's PIN in a popover, rendered only when
 * the server offers dial-in for this meeting; the host may draw a new PIN.
 */
export function RailDialInRow() {
  const { t } = useTranslation();
  const { meeting, canHost } = useDetail();
  const popover = useRailPopover();
  const { data } = useMeetingDialIn(meeting.id);
  const rotate = useRotateMeetingDialInPin(meeting.id);
  const [confirming, setConfirming] = useState(false);
  // A failed rotation is said where the PIN is read, while that PIN stands.
  const [rotateError, setRotateError] = useState<{ text: string; pin?: string } | null>(null);
  if (!data?.enabled || !data.number || !data.pin) return null;

  return (
    <div ref={popover.anchor}>
      <RailProp icon={Phone} label={t("meetings.detail.rail.dialIn")} value={data.number} onClick={popover.toggle} />
      <RailPopover
        state={popover}
        title={t("meetings.dialIn.title")}
        footer={
          canHost ? (
            <TextButton
              className="ml-auto"
              onClick={() => {
                popover.setOpen(false);
                setConfirming(true);
              }}
            >
              {t("meetings.dialIn.rotate")}
            </TextButton>
          ) : undefined
        }
      >
        <p className="text-caption text-muted-foreground">{t("meetings.dialIn.description")}</p>
        <dl className="mt-2">
          <div className="flex min-h-9 items-center justify-between gap-3">
            <dt className="shrink-0 text-caption text-muted-foreground">{t("meetings.dialIn.number")}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              {/* tel: dials on a phone; the spaces are for reading. Underlined and 44 tall on touch: it must read as tappable. */}
              <a
                href={`tel:${data.number.replace(/[^\d+]/g, "")}`}
                className="min-w-0 text-body tabular-nums text-foreground underline underline-offset-4 hover:decoration-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                {data.number}
              </a>
              <CopyValue value={data.number} label={t("meetings.dialIn.copyNumber")} />
            </dd>
          </div>
          <div className="flex min-h-9 items-center justify-between gap-3">
            <dt className="shrink-0 text-caption text-muted-foreground">{t("meetings.dialIn.pin")}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="font-mono text-body font-medium tracking-widest tabular-nums">{data.pin}</span>
              <CopyValue value={data.pin} label={t("meetings.dialIn.copyPin")} />
            </dd>
          </div>
        </dl>
      </RailPopover>
      {rotateError && rotateError.pin === data.pin ? (
        <NoticeLine tone="destructive" icon={CircleAlert} role="alert" className="mb-1.5">
          {rotateError.text}
        </NoticeLine>
      ) : null}
      <Dialog440
        open={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
        title={t("meetings.dialIn.rotateTitle")}
        description={t("meetings.dialIn.rotateHint")}
        footer={
          <>
            <Button type="button" variant="ghost" className={kitButton.ghost} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="brand"
              aria-disabled={rotate.isPending || undefined}
              onClick={() => {
                if (rotate.isPending) return;
                setRotateError(null);
                rotate.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success(t("meetings.dialIn.rotated"), { position: "bottom-center" });
                  },
                  // Close the question so the answer shows in the rail, behind no overlay.
                  onError: (err) => {
                    setConfirming(false);
                    setRotateError({ text: apiErrorCopy(err) ?? t("common.error"), pin: data.pin });
                  },
                });
              }}
            >
              {t("meetings.dialIn.rotate")}
            </Button>
          </>
        }
      />
    </div>
  );
}
