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

export interface LeaveDialogProps {
  open: boolean;
  /** A clean editor never needs a leave prompt, but callers may keep this
   * component mounted while the coordinator settles. */
  dirty?: boolean;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => Promise<boolean>;
  onKeepDraft: () => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
  onChoice?: (choice: LeaveChoice) => void;
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
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button type="button" onClick={() => void run("save", onSave)} disabled={Boolean(pending) || saving}>
            {pending === "save" ? t("working") : t("save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void run("keep", onKeepDraft)} disabled={Boolean(pending)}>
            {pending === "keep" ? t("working") : t("keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void run("discard", onDiscard)} disabled={Boolean(pending)}>
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
  const { t } = useTranslation(undefined, { keyPrefix: "office.recovery" });
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
            {metadata ? <span className="mt-2 block text-caption">{t("updated", { date: new Date(metadata.updatedAt).toLocaleString() })}</span> : null}
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter className="sm:flex-col sm:items-stretch">
          {!conflict && recoverable ? (
            <Button type="button" onClick={() => void run("recover", onRecover)} disabled={Boolean(pending)}>
              {pending === "recover" ? t("working") : t("recover")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void run("keep", onKeep)} disabled={Boolean(pending)}>
            {pending === "keep" ? t("working") : t("keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void run("discard", onDiscard)} disabled={Boolean(pending)}>
            {pending === "discard" ? t("working") : t("discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
