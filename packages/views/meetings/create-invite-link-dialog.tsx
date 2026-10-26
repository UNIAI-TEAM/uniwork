"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateInviteLink } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogFooter } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { defaultInviteLinkLabel } from "./invite-link-display";
import { expiresAtFromDays, inviteLinkUrl } from "./invite-link-url";

const DEFAULT_DAYS = "7";
// The host lets each guest in unless they choose otherwise: a leaked link then opens no door by itself.
const DEFAULT_MODE = "REQUEST_APPROVAL";
const COPIED_MS = 2000;

/** Values a caller starts the form from (a link that cannot be copied again, a failed create). */
export type InviteLinkDraft = { name?: string; mode?: string; days?: string; maxUses?: string };

/** Guests who let themselves in need a use limit (create brief AB, auto-admit floor). */
const needsLimit = (mode: string, maxUses: string) => mode === "AUTO_ADMIT" && !(Number(maxUses) >= 1);

export function CreateInviteLinkDialog({
  meetingId,
  open,
  onOpenChange,
  initial,
}: {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read when the dialog mounts: a caller with new values remounts it (`key`). */
  initial?: InviteLinkDraft;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const create = useCreateInviteLink(meetingId);
  const [name, setName] = useState(initial?.name ?? "");
  const [days, setDays] = useState(initial?.days ?? DEFAULT_DAYS);
  const [mode, setMode] = useState(initial?.mode ?? DEFAULT_MODE);
  const [maxUses, setMaxUses] = useState(initial?.maxUses ?? "");
  const [limitTouched, setLimitTouched] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const limitError = limitTouched && needsLimit(mode, maxUses);

  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setDays(DEFAULT_DAYS);
      setMode(DEFAULT_MODE);
      setMaxUses("");
      setLimitTouched(false);
      setFreshUrl(null);
      setCopied(false);
      window.clearTimeout(copiedTimer.current);
    }
    onOpenChange(next);
  };

  const handleCopy = useCallback(async () => {
    if (!freshUrl) return;
    if (await copyText(freshUrl)) {
      setCopied(true);
      toast.success(t("meetings.linkCopied"));
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      return;
    }
    toast.error(t("common.error"));
  }, [freshUrl, t]);

  const expiryItems = ["1", "7", "30"].map((value) => ({
    value,
    label: t("meetings.linkExpiryDays", { count: Number(value) }),
  }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <FormDialogContent size="md">
        <FormDialogHeader
          title={t("meetings.externalGuestLinks")}
          description={`${t("meetings.createInviteLinkDescription")} ${t("meetings.createInviteLinkGuestHint")}`}
        />

        {freshUrl ? (
          <>
            <FormDialogBody className="space-y-3">
              <p className="rounded-lg bg-success-soft px-3 py-2 text-label font-medium text-success-soft-foreground">
                {t("meetings.linkCreated")}
              </p>
              <p className="text-caption text-muted-foreground">{t("meetings.linkSecretOnce")}</p>
              <div className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface-hover p-3">
                <p className="min-w-0 flex-1 break-all text-caption text-foreground">{freshUrl}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
            </FormDialogBody>
            <DialogFooter className="items-center px-5 py-3">
              <Button type="button" onClick={() => close(false)}>
                {t("common.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (needsLimit(mode, maxUses)) {
                setLimitTouched(true);
                document.getElementById(`${id}-max`)?.focus();
                return;
              }
              const expires = expiresAtFromDays(Number(days), Date.now());
              const nowIso = new Date().toISOString();
              const defaultName = defaultInviteLinkLabel(nowIso, i18n.language, t);
              create.mutate(
                {
                  name: name.trim() || defaultName,
                  access_mode: mode,
                  expires_at: expires,
                  max_uses: maxUses ? Number(maxUses) : undefined,
                },
                {
                  onSuccess: (res) => {
                    const secret = res?.invite_link.secret;
                    const linkId = res?.invite_link.id;
                    if (!secret || !linkId) {
                      close(false);
                      return;
                    }
                    const url = inviteLinkUrl(linkId, secret);
                    setFreshUrl(url);
                    void copyText(url).then((ok) => {
                      if (ok) toast.success(t("meetings.linkCopied"));
                    });
                  },
                  onError: (err) => toastApiError(err, t("common.error")),
                },
              );
            }}
          >
            <FormDialogBody>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor={`${id}-name`}>{t("meetings.linkName")}</FieldLabel>
                  <Input
                    id={`${id}-name`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={defaultInviteLinkLabel(new Date().toISOString(), i18n.language, t)}
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-expiry`}>{t("meetings.linkExpiry")}</FieldLabel>
                  <Select id={`${id}-expiry`} value={days} onValueChange={(v) => v && setDays(v)} items={expiryItems} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-access`}>{t("meetings.linkGuestAccess")}</FieldLabel>
                  <Select
                    id={`${id}-access`}
                    value={mode}
                    onValueChange={(v) => v && setMode(v)}
                    items={[
                      { value: "AUTO_ADMIT", label: t("meetings.linkAutoAdmit") },
                      { value: "REQUEST_APPROVAL", label: t("meetings.linkNeedApproval") },
                    ]}
                  />
                  <FieldDescription>
                    {mode === "REQUEST_APPROVAL"
                      ? t("meetings.linkNeedApprovalGuestHint")
                      : `${t("meetings.linkAutoAdmitGuestHint")} ${t("meetings.detail.guestLink.limitHint")}`}
                  </FieldDescription>
                </Field>
                <Field data-invalid={limitError || undefined}>
                  <FieldLabel htmlFor={`${id}-max`}>{t("meetings.linkMaxUses")}</FieldLabel>
                  <Input
                    id={`${id}-max`}
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    onBlur={() => setLimitTouched(true)}
                    aria-invalid={limitError || undefined}
                    aria-describedby={limitError ? `${id}-max-error` : undefined}
                    placeholder={t("meetings.linkUnlimited")}
                  />
                  {limitError ? (
                    <FieldError id={`${id}-max-error`}>{t("meetings.detail.guestLink.limitRequired")}</FieldError>
                  ) : null}
                </Field>
              </FieldGroup>
            </FormDialogBody>
            <FormDialogFooter
              onCancel={() => close(false)}
              submitType="submit"
              submitLabel={t("meetings.createLink")}
              submittingLabel={t("meetings.creating")}
              submitting={create.isPending}
            />
          </form>
        )}
      </FormDialogContent>
    </Dialog>
  );
}
