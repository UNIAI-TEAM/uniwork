"use client";
import { CircleAlert, Copy, Phone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingDialIn, useRotateMeetingDialInPin } from "@uniwork/core/meetings/dial-in";
import { Button } from "@uniwork/ui/components/ui/button";
import { apiErrorCopy } from "../api-error-copy";
import { ConfirmDialog } from "../common/form-dialog";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";

/**
 * How to call into the meeting by phone (spec 2026-10-20-meeting-scribe-agent-design
 * §5.4): the deployment's number and the meeting's PIN. Hidden unless the
 * server offers dial-in for this meeting; the host may draw a new PIN.
 */
/** A value to read aloud or type: copied whole, digits and all. */
function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const copy = () => {
    // No clipboard outside a secure context: say so rather than do nothing.
    if (!navigator.clipboard) {
      toast.error(t("meetings.dialIn.copyFailed"));
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("common.copied")))
      .catch(() => toast.error(t("meetings.dialIn.copyFailed")));
  };
  return (
    <Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={label} onClick={copy}>
      <Copy aria-hidden />
    </Button>
  );
}

export function MeetingDialInSection({ meetingId, canHost }: { meetingId: string; canHost: boolean }) {
  const { t } = useTranslation();
  const { data } = useMeetingDialIn(meetingId);
  const rotate = useRotateMeetingDialInPin(meetingId);
  const [confirming, setConfirming] = useState(false);
  // A PIN that did not change is said on the card, where the PIN is read.
  const [rotateError, setRotateError] = useState<string | null>(null);
  if (!data?.enabled || !data.number || !data.pin) return null;

  return (
    <>
      <PanelCard
        id="dial-in-heading"
        icon={Phone}
        iconTone={moduleTone("meetings")}
        title={t("meetings.dialIn.title")}
        description={t("meetings.dialIn.description")}
        footer={
          canHost ? (
            // A rare, disruptive chore: quieter than anything a caller needs.
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              {t("meetings.dialIn.rotate")}
            </Button>
          ) : undefined
        }
      >
        <dl className="-my-2 divide-y divide-border">
          <div className="flex items-center justify-between gap-3 py-1.5">
            <dt className="shrink-0 text-label text-muted-foreground">{t("meetings.dialIn.number")}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              {/* tel: dials on a phone; the spaces are for reading, not dialling. */}
              {/* Underlined at rest and 44px tall on touch: it must read as tappable. */}
              <a
                href={`tel:${data.number.replace(/[^\d+]/g, "")}`}
                className="min-w-0 text-right text-body tabular-nums text-foreground underline underline-offset-4 hover:decoration-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                {data.number}
              </a>
              <CopyValue value={data.number} label={t("meetings.dialIn.copyNumber")} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <dt className="shrink-0 text-label text-muted-foreground">{t("meetings.dialIn.pin")}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="text-right text-body font-medium tabular-nums tracking-widest text-foreground">{data.pin}</span>
              <CopyValue value={data.pin} label={t("meetings.dialIn.copyPin")} />
            </dd>
          </div>
        </dl>
        {rotateError ? (
          <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive" className="mt-3">
            {rotateError}
          </Notice>
        ) : null}
      </PanelCard>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("meetings.dialIn.rotateTitle")}
        description={t("meetings.dialIn.rotateHint")}
        confirmLabel={t("meetings.dialIn.rotate")}
        pending={rotate.isPending}
        onConfirm={() => {
          setRotateError(null);
          rotate.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              toast.success(t("meetings.dialIn.rotated"));
            },
            // Close the question so its answer shows on the card, behind no overlay.
            onError: (err) => {
              setConfirming(false);
              setRotateError(apiErrorCopy(err) ?? t("common.error"));
            },
          });
        }}
      />
    </>
  );
}
