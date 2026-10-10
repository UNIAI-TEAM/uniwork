"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import type { DraftMetadata } from "@uniwork/core/office";

export type LeaveChoice = "save" | "keep" | "discard" | "stay";

// Discard sits on the dialog footer's raised fill, where the destructive variant's
// translucent tint lets the dark label drop under 4.5:1 (4.18 measured). The opaque
// soft pair holds 6.25 light / 5.58 dark on any ground; hover marks the edge instead
// of deepening the tint.
const DISCARD_CLASS = "bg-destructive-soft text-destructive-soft-foreground hover:bg-destructive-soft hover:border-destructive/40 dark:bg-destructive-soft dark:hover:bg-destructive-soft";

export interface LeaveDialogProps {
  open: boolean;
  /** A clean editor never needs a leave prompt, but callers may keep this
   * component mounted while the coordinator settles. */
  dirty?: boolean;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => Promise<boolean>;
  /** Absent when the editor has no device draft store (the Docs frame): no "keep" choice. */
  onKeepDraft?: () => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
  onChoice?: (choice: LeaveChoice) => void;
  /** Overrides the account save wording for a leave set that saves to the
   * device instead of the UniWork library. */
  saveLabel?: string;
}

export interface DraftRecoveryPromptProps {
  open: boolean;
  metadata?: DraftMetadata | null;
  conflict?: boolean;
  /** Locked/blocked records may be kept or discarded, never applied. */
  recoverable?: boolean;
  onRecover: () => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
  onKeep: () => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}

/**
 * The navigation decision lives here instead of in the router. Save and keep
 * are allowed to close the dialog only after their callers confirm durable
 * success; a failed write therefore cannot turn into an accidental leave.
 */
export function LeaveDialog({
  open,
  dirty = true,
  saving = false,
  onOpenChange,
  onSave,
  onKeepDraft,
  onDiscard,
  onChoice,
  saveLabel,
}: LeaveDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.leave" });
  const [pending, setPending] = useState<LeaveChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!open) {
      setPending(null);
      setError(null);
    }
  }, [open]);

  const run = async (choice: Exclude<LeaveChoice, "stay">, action: () => Promise<boolean>) => {
    if (pending) return;
    setPending(choice);
    setError(null);
    try {
      const allowed = await action();
      if (!mounted.current) return;
      if (!allowed) {
        setError(t("write_failed"));
        return;
      }
      onChoice?.(choice);
      onOpenChange(false);
    } catch {
      if (!mounted.current) return;
      setError(t("write_failed"));
    } finally {
      if (mounted.current) setPending(null);
    }
  };

  const stay = () => {
    if (pending) return;
    onChoice?.("stay");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!pending}
        closeLabel={t("stay")}
        aria-describedby="office-leave-description"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription id="office-leave-description">
            {dirty ? t("description") : t("clean_description")}
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter className="flex-col items-stretch sm:flex-col">
          <Button type="button" onClick={() => void run("save", onSave)} disabled={Boolean(pending) || saving}>
            {pending === "save" ? t("working") : (saveLabel ?? t("save"))}
          </Button>
          {onKeepDraft ? (
            <Button type="button" variant="outline" onClick={() => void run("keep", onKeepDraft)} disabled={Boolean(pending)}>
              {pending === "keep" ? t("working") : t("keep")}
            </Button>
          ) : null}
          <Button type="button" variant="destructive" className={DISCARD_CLASS} onClick={() => void run("discard", onDiscard)} disabled={Boolean(pending)}>
            {pending === "discard" ? t("working") : t("discard")}
          </Button>
          <Button type="button" variant="ghost" onClick={stay} disabled={Boolean(pending)}>{t("stay")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Recovery is a separate dialog so a found draft never gets confused with a
 * navigation decision. A changed base is explicitly labelled as a conflict;
 * it can be discarded or kept durable, but it is never silently applied. */
export function DraftRecoveryPrompt({
  open,
  metadata,
  conflict = false,
  recoverable = true,
  onRecover,
  onDiscard,
  onKeep,
  onOpenChange,
}: DraftRecoveryPromptProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "office.recovery" });
  const [pending, setPending] = useState<"recover" | "discard" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (choice: "recover" | "discard" | "keep", action: () => Promise<boolean>) => {
    if (pending) return;
    setPending(choice);
    setError(null);
    try {
      if (await action()) onOpenChange(false);
      else setError(t("write_failed"));
    } catch {
      setError(t("write_failed"));
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending} closeLabel={t("keep")}>
        <DialogHeader>
          <DialogTitle>{t(conflict ? "conflict_title" : "title")}</DialogTitle>
          <DialogDescription>
            {t(conflict ? "conflict_description" : "description")}
            {metadata ? <span className="mt-2 block text-caption">{t("updated", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(metadata.updatedAt)) })}</span> : null}
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter className="flex-col items-stretch sm:flex-col">
          {!conflict && recoverable ? (
            <Button type="button" onClick={() => void run("recover", onRecover)} disabled={Boolean(pending)}>
              {pending === "recover" ? t("working") : t("recover")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void run("keep", onKeep)} disabled={Boolean(pending)}>
            {pending === "keep" ? t("working") : t("keep")}
          </Button>
          <Button type="button" variant="destructive" className={DISCARD_CLASS} onClick={() => void run("discard", onDiscard)} disabled={Boolean(pending)}>
            {pending === "discard" ? t("working") : t("discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
