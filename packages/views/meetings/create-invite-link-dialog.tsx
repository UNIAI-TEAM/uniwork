"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateInviteLink } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { toast } from "sonner";
import { defaultInviteLinkLabel } from "./invite-link-display";

const DEFAULT_DAYS = "7";
const DEFAULT_MODE = "AUTO_ADMIT";

function resetDraft() {
  return {
    name: "",
    days: DEFAULT_DAYS,
    mode: DEFAULT_MODE,
    maxUses: "",
    freshUrl: null as string | null,
  };
}

export function CreateInviteLinkDialog({
  meetingId,
  open,
  onOpenChange,
}: {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const create = useCreateInviteLink(meetingId);
  const [name, setName] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [maxUses, setMaxUses] = useState("");
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      const draft = resetDraft();
      setName(draft.name);
      setDays(draft.days);
      setMode(draft.mode);
      setMaxUses(draft.maxUses);
      setFreshUrl(draft.freshUrl);
      setCopied(false);
    }
    onOpenChange(next);
  };

  const handleCopy = useCallback(async () => {
    if (!freshUrl) return;
    if (await copyText(freshUrl)) {
      setCopied(true);
      toast.success(t("meetings.linkCopied"));
      window.setTimeout(() => setCopied(false), 2000);
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
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("meetings.newInviteLink")}</DialogTitle>
          <DialogDescription>{t("meetings.createInviteLinkDescription")}</DialogDescription>
        </DialogHeader>

        {freshUrl ? (
          <div className="space-y-3">
            <p className="text-label text-success">{t("meetings.linkCreated")}</p>
            <p className="text-caption text-muted-foreground">{t("meetings.linkSecretOnce")}</p>
            <div className="flex min-w-0 items-start gap-1.5 rounded-lg border border-border bg-surface-hover p-3">
              <p className="min-w-0 flex-1 break-all text-caption text-foreground">{freshUrl}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => void handleCopy()}
                aria-label={t("meetings.copyLink")}
              >
                {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                {t("common.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const expires = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
              const nowIso = new Date().toISOString();
              const defaultName = defaultInviteLinkLabel(nowIso, i18n.language);
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
                    const id = res?.invite_link.id;
                    if (!secret || !id) {
                      close(false);
                      return;
                    }
                    const url = `${runtimeConfig().appUrl}${paths.meetingInvite(id)}#secret=${secret}`;
                    setFreshUrl(url);
                    void copyText(url).then((ok) => {
                      if (ok) toast.success(t("meetings.linkCopied"));
                    });
                  },
                  onError: () => toast.error(t("common.error")),
                },
              );
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="link-name">{t("meetings.linkName")}</FieldLabel>
                <Input
                  id="link-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={defaultInviteLinkLabel(new Date().toISOString(), i18n.language)}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel>{t("meetings.linkExpiry")}</FieldLabel>
                <Select value={days} onValueChange={(v) => v && setDays(v)} items={expiryItems} />
              </Field>
              <Field>
                <FieldLabel>{t("meetings.linkAccess")}</FieldLabel>
                <Select
                  value={mode}
                  onValueChange={(v) => v && setMode(v)}
                  items={[
                    { value: "AUTO_ADMIT", label: t("meetings.linkAutoAdmit") },
                    { value: "REQUEST_APPROVAL", label: t("meetings.linkNeedApproval") },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="link-max">{t("meetings.linkMaxUses")}</FieldLabel>
                <Input
                  id="link-max"
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder={t("meetings.linkUnlimited")}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t("meetings.createLink")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
