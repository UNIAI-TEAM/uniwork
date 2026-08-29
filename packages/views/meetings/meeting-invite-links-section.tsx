"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inviteLinkStatus, useCreateInviteLink, useInviteLinks, useRevokeInviteLink } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { MeetingLinkBadge } from "./meeting-status-badge";

export function MeetingInviteLinksSection({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { data: links } = useInviteLinks(meetingId);
  const create = useCreateInviteLink(meetingId);
  const revoke = useRevokeInviteLink(meetingId);
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [mode, setMode] = useState("AUTO_ADMIT");
  const [maxUses, setMaxUses] = useState("");
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  return (
    <section className="mt-6" aria-labelledby="invite-links-heading">
      <h3 id="invite-links-heading" className="mb-2 text-label font-medium text-muted-foreground">
        {t("meetings.inviteLink")}
      </h3>
      <ul className="mb-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {(links ?? []).map((link) => {
          const status = inviteLinkStatus(link, new Date());
          return (
            <li key={link.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-body text-foreground">{link.name}</div>
                <div className="text-caption text-muted-foreground">
                  {link.access_mode === "REQUEST_APPROVAL" ? t("meetings.linkNeedApproval") : t("meetings.linkAutoAdmit")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <MeetingLinkBadge status={status} />
                {status === "active" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(link.id, { onError: () => toast.error(t("common.error")) })}
                  >
                    {t("meetings.revokeLink")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const expires = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
          create.mutate(
            {
              name: name.trim() || t("meetings.inviteLink"),
              access_mode: mode,
              expires_at: expires,
              max_uses: maxUses ? Number(maxUses) : undefined,
            },
            {
              onSuccess: (res) => {
                const secret = res?.invite_link.secret;
                const id = res?.invite_link.id;
                setName("");
                setMaxUses("");
                if (!secret || !id) {
                  setFreshUrl(null);
                  return;
                }
                const url = `${runtimeConfig().appUrl}${paths.meetingInvite(id)}#secret=${secret}`;
                setFreshUrl(url);
                void navigator.clipboard.writeText(url).then(
                  () => toast.success(t("meetings.linkCopied")),
                  () => undefined,
                );
              },
              onError: () => toast.error(t("common.error")),
            },
          );
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="link-name">{t("meetings.linkName")}</FieldLabel>
            <Input id="link-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("meetings.linkExpiry")}</FieldLabel>
              <Select
                value={days}
                onValueChange={(v) => v && setDays(v)}
                items={["1", "7", "30"].map((d) => ({ value: d, label: t("meetings.linkDays", { count: Number(d) }) }))}
              />
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
          </div>
          <Field>
            <FieldLabel htmlFor="link-max">{t("meetings.linkMaxUses")}</FieldLabel>
            <Input id="link-max" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t("meetings.linkUnlimited")} />
          </Field>
        </FieldGroup>
        <Button type="submit" size="sm" variant="outline" disabled={create.isPending}>
          {t("meetings.createLink")}
        </Button>
      </form>
      {freshUrl ? (
        <div className="mt-2 space-y-1">
          <p className="text-caption text-muted-foreground">{t("meetings.linkSecretOnce")}</p>
          <p className="break-all text-caption text-foreground">{freshUrl}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(freshUrl).then(
                () => toast.success(t("meetings.linkCopied")),
                () => toast.error(t("common.error")),
              );
            }}
          >
            {t("meetings.copyLink")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
