"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInvite, useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export function MembersView({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const invite = useInvite(workspaceId);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-semibold text-primary">{t("workspace.members")}</h1>
      <ul className="mb-6 divide-y divide-line rounded-lg border border-line bg-surface">
        {(members ?? []).map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div className="text-sm text-primary">{m.display_name}</div>
              <div className="text-[12px] text-tertiary">{m.email}</div>
            </div>
            <span className="text-[12px] text-secondary">{m.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate(
            { email, role: "member" },
            {
              onSuccess: (d) =>
                setInviteLink(`${window.location.origin}/invite/${d.invitation.token}`),
            },
          );
        }}
      >
        <Input
          type="email"
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={invite.isPending}>
          {t("workspace.invite")}
        </Button>
      </form>
      {inviteLink && (
        <p className="mt-3 break-all rounded border border-line bg-subtle p-2 text-[13px] text-secondary">
          {t("workspace.inviteLink")}: {inviteLink}
        </p>
      )}
    </div>
  );
}
